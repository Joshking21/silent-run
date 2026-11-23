package expo.modules.smartspectrabridge

import android.hardware.camera2.CaptureRequest
import android.os.Debug
import android.util.Range
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.LifecycleOwner
import com.presagetech.smartspectra.CustomInput
import com.presagetech.smartspectra.FrameSubmissionResult
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import androidx.core.content.ContextCompat
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * App-owned CameraX capture that feeds SmartSpectra through custom input.
 *
 * Why: with SDK-owned capture on low-RAM phones (Infinix Hot 60i, 4 GB) the
 * native heap grew without bound until Android's low-memory killer closed the
 * app. Here we control the load:
 *  - low analysis resolution (default 640x480)
 *  - STRATEGY_KEEP_ONLY_LATEST, so frames never queue behind a slow consumer
 *  - an fps cap, dropping frames before they reach the SDK
 *  - sendFrame() runs on one worker thread, so at most one frame is in flight
 */
@OptIn(ExperimentalCamera2Interop::class)
class ThrottledCapture(
  private val input: CustomInput,
  private val maxFps: Int,
  private val width: Int,
  private val height: Int,
) {
  private val worker: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "silentrun-capture").apply { priority = Thread.NORM_PRIORITY }
  }
  private var provider: ProcessCameraProvider? = null
  private var analysis: ImageAnalysis? = null
  private var preview: Preview? = null

  private val minIntervalNs = if (maxFps > 0) 1_000_000_000L / maxFps else 0L
  private var lastSentNs = 0L

  // Stats (read from any thread).
  val received = AtomicLong()
  val sent = AtomicLong()
  val throttled = AtomicLong()
  val rejected = AtomicLong()
  private val sendNanos = AtomicLong()
  @Volatile var lastReject: String? = null
  private var lastLogAt = 0L

  private val previewListener: (Preview.SurfaceProvider?) -> Unit = { sp ->
    preview?.surfaceProvider = sp
  }

  /** Call on the main thread after sdk.start() has completed. */
  suspend fun start(owner: LifecycleOwner, context: android.content.Context) {
    val future = ProcessCameraProvider.getInstance(context)
    val p = suspendCancellableCoroutine<ProcessCameraProvider> { cont ->
      future.addListener(
        { runCatching { future.get() }.onSuccess { cont.resume(it) }.onFailure { cont.resumeWithException(it) } },
        ContextCompat.getMainExecutor(context),
      )
    }
    provider = p

    val selector = ResolutionSelector.Builder()
      .setResolutionStrategy(
        ResolutionStrategy(Size(width, height), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
      )
      .build()

    // Budget front cameras drop to ~15 fps indoors (longer exposure). The SDK
    // then never validates (FRAME_RATE_TOO_LOW) and ends the session, so pin
    // auto-exposure to a fixed rate. Darker image, but rPPG needs the rate.
    val fps = maxFps.coerceIn(15, 30)
    val fpsRange = Range(fps, fps)

    val ab = ImageAnalysis.Builder()
    Camera2Interop.Extender(ab).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange)
    val a = ab
      .setResolutionSelector(selector)
      .setTargetRotation(Surface.ROTATION_0)
      .setOutputImageRotationEnabled(true)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .build()
    a.setAnalyzer(worker) { image ->
      received.incrementAndGet()
      try {
        val ts = image.imageInfo.timestamp
        if (minIntervalNs > 0 && lastSentNs != 0L && ts - lastSentNs < minIntervalNs) {
          throttled.incrementAndGet()
        } else {
          lastSentNs = ts
          val t0 = SystemClock.elapsedRealtimeNanos()
          val r = input.sendFrame(image)
          sendNanos.addAndGet(SystemClock.elapsedRealtimeNanos() - t0)
          if (r is FrameSubmissionResult.Rejected) {
            rejected.incrementAndGet()
            lastReject = r.error.code.name
          } else {
            sent.incrementAndGet()
          }
        }
      } catch (t: Throwable) {
        rejected.incrementAndGet()
        lastReject = t.javaClass.simpleName
      } finally {
        image.close()
      }
      maybeLog()
    }
    analysis = a

    val pb = Preview.Builder()
    Camera2Interop.Extender(pb).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange)
    val pv = pb.setResolutionSelector(selector).build()
    pv.surfaceProvider = PreviewHub.current
    preview = pv
    PreviewHub.listeners += previewListener

    p.unbindAll()
    p.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, pv, a)
    analysis?.resolutionInfo?.let { Log.i(TAG, "analysis resolution ${it.resolution}, maxFps=$maxFps") }
  }

  /** Call on the main thread, before sdk.stop(). */
  fun stop() {
    PreviewHub.listeners -= previewListener
    analysis?.clearAnalyzer()
    val p = provider
    if (p != null) {
      analysis?.let { p.unbind(it) }
      preview?.let { p.unbind(it) }
    }
    analysis = null
    preview = null
    worker.shutdown()
  }

  fun stats(): Map<String, Any?> {
    val s = sent.get()
    return mapOf(
      "mode" to "custom",
      "received" to received.get(),
      "sent" to s,
      "throttled" to throttled.get(),
      "rejected" to rejected.get(),
      "lastReject" to lastReject,
      "avgSendMs" to if (s > 0) sendNanos.get() / s / 1e6 else 0.0,
      "nativeHeapMb" to Debug.getNativeHeapAllocatedSize() / 1_048_576.0,
    )
  }

  private fun maybeLog() {
    val now = SystemClock.elapsedRealtime()
    if (now - lastLogAt < 5_000) return
    lastLogAt = now
    Log.i(TAG, "capture ${stats()}")
  }

  companion object {
    const val TAG = "SilentRun"
  }
}

/** Shares the on-screen PreviewView surface between the view and capture. */
object PreviewHub {
  var current: Preview.SurfaceProvider? = null
    set(value) {
      field = value
      listeners.toList().forEach { it(value) }
    }
  val listeners = ArrayList<(Preview.SurfaceProvider?) -> Unit>()
}
