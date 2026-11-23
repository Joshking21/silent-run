package expo.modules.smartspectrabridge

import android.os.SystemClock
import androidx.camera.core.Preview
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.presagetech.smartspectra.CameraSelection
import com.presagetech.smartspectra.CustomInput
import com.presagetech.smartspectra.FrameTransform
import com.presagetech.smartspectra.ProcessingStatus
import com.presagetech.smartspectra.SmartSpectraConfig
import com.presagetech.smartspectra.SmartSpectraError
import com.presagetech.smartspectra.SmartSpectraException
import com.presagetech.smartspectra.SmartSpectraSdk
import com.presagetech.smartspectra.ValidationStatus
import com.presagetech.smartspectra.proto.MetricTypesProto.MetricType
import com.presagetech.smartspectra.proto.MetricsProto.Metrics
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ConfigureOptions : Record {
  /** Request landmarks/blinking/talking/expressions. Needs a face-enabled key. */
  @Field val faceMetrics: Boolean = true
  /** Request pulse/HRV/arterial trace. */
  @Field val cardioMetrics: Boolean = true
  /**
   * Feed frames from our own throttled CameraX capture (bounded memory) instead
   * of letting the SDK own the camera. See ThrottledCapture.
   */
  @Field val customCapture: Boolean = true
  /** Camera rate (pinned via AE target range) and send cap for custom capture. */
  @Field val maxFps: Int = 30
  @Field val captureWidth: Int = 640
  @Field val captureHeight: Int = 480
}

/**
 * Bridges the SmartSpectra Android SDK to JS.
 *
 * Events:
 *  - onFastSignals  frame-driven face state, on change or ≤10 Hz
 *  - onVitals       pulse / HRV / breathing rate, only when a new sample exists
 *  - onTrace        batched chest breathing trace, ~10 Hz
 *  - onStatus       processing + validation (framing/lighting) changes
 *  - onError        SDK errors
 */
class SmartSpectraBridgeModule : Module() {
  private val sdk: SmartSpectraSdk get() = SmartSpectraSdk.shared
  private var scope = newScope()
  private var metricsJob: Job? = null
  private var observersAttached = false
  private var configured = false

  // Custom (app-owned) capture state.
  private var options = ConfigureOptions()
  private var customInput: CustomInput? = null
  private var capture: ThrottledCapture? = null

  /** Keeps the SDK's own preview binding in sync in SDK-camera mode. */
  private val previewSync: (Preview.SurfaceProvider?) -> Unit = { sp ->
    if (customInput == null) sdk.config.previewSurfaceProvider = sp
  }

  // Last-emitted state, for change detection and throttling.
  private var lastFastAt = 0L
  private var lastBlinking = false
  private var lastTalking = false
  private var lastExpression = "UNKNOWN"
  private var blinkCount = 0
  private var lastPulseTs = Long.MIN_VALUE
  private var lastHrvTs = Long.MIN_VALUE
  private var lastBreathTs = Long.MIN_VALUE
  private var lastChestTs = Long.MIN_VALUE
  private val chestBuf = ArrayList<Double>(16)
  private var lastTraceFlushAt = 0L

  private val statusObserver = Observer<ProcessingStatus> { emitStatus() }
  private val validationObserver = Observer<ValidationStatus?> { emitStatus() }
  private val errorObserver = Observer<SmartSpectraError?> { err ->
    if (err != null) sendEvent("onError", errorMap(err))
  }

  override fun definition() = ModuleDefinition {
    Name("SmartSpectraBridge")

    Events("onFastSignals", "onVitals", "onTrace", "onStatus", "onError")

    Function("isApiKeyConfigured") { BuildConfig.PRESAGE_API_KEY.isNotBlank() }

    Function("getSdkVersion") { runCatching { sdk.version }.getOrDefault("unknown") }

    AsyncFunction("configure") Coroutine { options: ConfigureOptions ->
      withContext(Dispatchers.Main) { applyConfig(options) }
    }

    AsyncFunction("start") Coroutine { ->
      withContext(Dispatchers.Main) {
        if (!configured) applyConfig(ConfigureOptions())
        attachObservers()
        resetSessionState()
        startMetricsCollection()
        try {
          sdk.start()
        } catch (e: SmartSpectraException) {
          throw toCoded(e.error)
        }
        val input = customInput
        if (input != null) {
          val owner = appContext.currentActivity as? LifecycleOwner
            ?: throw CodedException("E_NO_ACTIVITY", "No foreground activity to bind the camera to.", null)
          val c = ThrottledCapture(input, options.maxFps, options.captureWidth, options.captureHeight)
          try {
            c.start(owner, appContext.reactContext ?: throw IllegalStateException("No context"))
            capture = c
          } catch (t: Throwable) {
            c.stop()
            runCatching { sdk.stop() }
            throw CodedException("E_CAPTURE_FAILED", t.message ?: t.javaClass.simpleName, t)
          }
        }
      }
    }

    Function("getPipelineStats") {
      capture?.stats() ?: mapOf(
        "mode" to if (customInput != null) "custom" else "sdk-camera",
        "nativeHeapMb" to android.os.Debug.getNativeHeapAllocatedSize() / 1_048_576.0,
      )
    }

    AsyncFunction("stop") Coroutine { ->
      withContext(Dispatchers.Main) { stopInternal() }
    }

    AsyncFunction("checkDeviceReadiness") Coroutine { ->
      withContext(Dispatchers.Main) {
        if (!configured) applyConfig(ConfigureOptions())
        val r = sdk.checkDeviceReadiness()
        mapOf("verdict" to r.verdict.name, "reason" to r.reason)
      }
    }

    OnActivityEntersBackground {
      // Camera must never run when the app isn't visible (consent rule).
      scope.launch(Dispatchers.Main) { runCatching { stopInternal() } }
    }

    OnCreate {
      PreviewHub.listeners += previewSync
    }

    OnDestroy {
      PreviewHub.listeners -= previewSync
      runCatching { capture?.stop() }
      capture = null
      runCatching {
        sdk.processingStatus.removeObserver(statusObserver)
        sdk.validationStatus.removeObserver(validationObserver)
        sdk.error.removeObserver(errorObserver)
      }
      scope.cancel()
    }

    View(SmartSpectraPreviewView::class) {}
  }

  // --- configuration --------------------------------------------------------

  private fun applyConfig(o: ConfigureOptions) {
    val key = BuildConfig.PRESAGE_API_KEY
    if (key.isBlank()) {
      throw CodedException(
        "E_NO_API_KEY",
        "PRESAGE_API_KEY is empty. Add it to .env and rebuild the dev client.",
        null,
      )
    }
    val status = sdk.processingStatus.value
    if (status == ProcessingStatus.RUNNING || status == ProcessingStatus.STARTING) {
      throw CodedException("E_BUSY", "Stop the SDK before reconfiguring.", null)
    }
    sdk.config.apiKey = key
    sdk.config.imageOutputEnabled = false // we use the CameraX preview surface instead
    sdk.config.enableTelemetry = false // matches our "nothing leaves the device" promise
    // Log level left at the SDK default (WARNING): SmartSpectraLogLevel's package
    // isn't documented and isn't needed for the game.
    options = o
    if (o.customCapture) {
      // We own the camera (and its preview); the SDK only sees our frames.
      customInput = sdk.useCustomInput(FrameTransform.NONE)
      sdk.config.previewSurfaceProvider = null
    } else {
      customInput = null
      sdk.useCamera(CameraSelection.Front)
      sdk.config.previewSurfaceProvider = PreviewHub.current
    }

    val metrics = ArrayList<MetricType>(SmartSpectraConfig.breathingMetrics)
    if (o.cardioMetrics) metrics += SmartSpectraConfig.cardioMetrics
    if (o.faceMetrics) {
      metrics += listOf(MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS)
    }
    sdk.config.requestedMetrics = metrics
    configured = true
  }

  private fun attachObservers() {
    if (observersAttached) return
    sdk.processingStatus.observeForever(statusObserver)
    sdk.validationStatus.observeForever(validationObserver)
    sdk.error.observeForever(errorObserver)
    observersAttached = true
  }

  private suspend fun stopInternal() {
    // Stop feeding frames before the SDK stops, so none arrive mid-teardown.
    capture?.stop()
    capture = null
    when (sdk.processingStatus.value) {
      ProcessingStatus.RUNNING, ProcessingStatus.STARTING -> sdk.stop()
      else -> Unit
    }
    metricsJob?.cancel()
    metricsJob = null
  }

  private fun newScope() = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  private fun resetSessionState() {
    lastFastAt = 0L
    lastBlinking = false
    lastTalking = false
    lastExpression = "UNKNOWN"
    blinkCount = 0
    lastPulseTs = Long.MIN_VALUE
    lastHrvTs = Long.MIN_VALUE
    lastBreathTs = Long.MIN_VALUE
    lastChestTs = Long.MIN_VALUE
    chestBuf.clear()
    lastTraceFlushAt = 0L
  }

  // --- metrics → events ------------------------------------------------------

  private fun startMetricsCollection() {
    metricsJob?.cancel()
    // metricsFlow is lossless (LiveData can drop trace samples under load).
    metricsJob = scope.launch {
      sdk.metricsFlow.collect { m -> handleMetrics(m) }
    }
  }

  private fun handleMetrics(m: Metrics) {
    val now = System.currentTimeMillis()
    val mono = SystemClock.elapsedRealtime()

    if (m.hasFace()) handleFace(m, now, mono)

    // Vitals: only emit when at least one genuinely new sample arrived.
    var pulse: Double? = null
    var rmssd: Double? = null
    var hrvStable = false
    var breathRate: Double? = null
    if (m.hasCardio()) {
      m.cardio.pulseRateList.lastOrNull { it.timestamp > 0 }?.let {
        if (it.timestamp > lastPulseTs) {
          lastPulseTs = it.timestamp
          pulse = it.value.toDouble()
        }
      }
      m.cardio.hrvList.lastOrNull()?.let {
        if (it.timestamp > lastHrvTs && it.rmssd > 0) {
          lastHrvTs = it.timestamp
          rmssd = it.rmssd
          hrvStable = it.stable
        }
      }
    }
    if (m.hasBreathing()) {
      m.breathing.rateList.lastOrNull { it.timestamp > 0 }?.let {
        if (it.timestamp > lastBreathTs) {
          lastBreathTs = it.timestamp
          breathRate = it.value.toDouble()
        }
      }
      m.breathing.upperTraceList.forEach { s ->
        if (s.timestamp > lastChestTs) {
          lastChestTs = s.timestamp
          chestBuf.add(s.value.toDouble())
        }
      }
    }
    if (pulse != null || rmssd != null || breathRate != null) {
      sendEvent(
        "onVitals",
        mapOf(
          "pulseRate" to pulse,
          "hrvRmssd" to rmssd,
          "hrvStable" to hrvStable,
          "breathingRate" to breathRate,
          "t" to now,
        ),
      )
    }

    if (chestBuf.isNotEmpty() && mono - lastTraceFlushAt >= TRACE_FLUSH_MS) {
      lastTraceFlushAt = mono
      sendEvent("onTrace", mapOf("chest" to chestBuf.toList(), "t" to now))
      chestBuf.clear()
    }
  }

  private fun handleFace(m: Metrics, now: Long, mono: Long) {
    val face = m.face
    val blinking = face.blinkingList.lastOrNull()?.detected ?: lastBlinking
    val talking = face.talkingList.lastOrNull()?.detected ?: lastTalking

    var expression = lastExpression
    var confidence = 0.0
    face.expressionList.lastOrNull()?.let { expr ->
      expr.scoresList.filter { it.confidence > 0f }.maxByOrNull { it.confidence }?.let { top ->
        expression = top.type.name.removePrefix("EXPRESSION_TYPE_").uppercase()
        confidence = top.confidence.toDouble()
      }
    }

    // Count blinks natively so a ~150 ms blink can't fall between JS frames.
    if (blinking && !lastBlinking) blinkCount++

    val changed = blinking != lastBlinking || talking != lastTalking || expression != lastExpression
    lastBlinking = blinking
    lastTalking = talking
    lastExpression = expression

    if (changed || mono - lastFastAt >= FAST_HEARTBEAT_MS) {
      lastFastAt = mono
      sendEvent(
        "onFastSignals",
        mapOf(
          "isBlinking" to blinking,
          "isTalking" to talking,
          "expression" to expression,
          "expressionConfidence" to confidence,
          "blinkCount" to blinkCount,
          "t" to now,
        ),
      )
    }
  }

  private fun emitStatus() {
    val v = sdk.validationStatus.value
    sendEvent(
      "onStatus",
      mapOf(
        "processing" to (sdk.processingStatus.value?.name ?: "IDLE"),
        "quality" to (v?.code?.name ?: "UNKNOWN"),
        "hint" to (v?.hint ?: ""),
        "t" to System.currentTimeMillis(),
      ),
    )
  }

  private fun errorMap(e: SmartSpectraError) = mapOf(
    "code" to e.code.name,
    "message" to e.message,
    "retryable" to e.retryable,
  )

  private fun toCoded(e: SmartSpectraError) =
    CodedException("E_${e.code.name}", e.message, null)

  private companion object {
    const val FAST_HEARTBEAT_MS = 100L
    const val TRACE_FLUSH_MS = 100L
  }
}
