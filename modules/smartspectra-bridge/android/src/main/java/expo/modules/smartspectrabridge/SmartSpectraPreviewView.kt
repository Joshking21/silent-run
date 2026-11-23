package expo.modules.smartspectrabridge

import android.content.Context
import android.graphics.Color
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import com.presagetech.smartspectra.SmartSpectraSdk
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Hosts a CameraX PreviewView and hands its surface to SmartSpectra.
 *
 * The SDK binds the preview use case when processing *starts*, so mount this
 * view before calling start() (CalibrationScreen does). Unmounting releases
 * the surface so a later screen can claim it.
 */
class SmartSpectraPreviewView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  // CameraX's PreviewView sizes its own children; let Android lay it out.
  override val shouldUseAndroidLayout = true

  private val previewView = PreviewView(context).apply {
    setBackgroundColor(Color.BLACK)
    scaleType = PreviewView.ScaleType.FILL_CENTER
    // COMPATIBLE (TextureView) behaves inside RN view hierarchies and allows
    // rounded/clipped containers, unlike SurfaceView.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  init {
    addView(
      previewView,
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
    )
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached.remove(this)
    attached.add(this)
    PreviewHub.current = previewView.surfaceProvider
  }

  override fun onDetachedFromWindow() {
    attached.remove(this)
    if (PreviewHub.current === previewView.surfaceProvider) {
      // Hand the surface back to the most recently attached remaining preview
      // (e.g. the app's persistent dock after the Signal Lab closes).
      PreviewHub.current = attached.lastOrNull()?.previewView?.surfaceProvider
    }
    super.onDetachedFromWindow()
  }

  private companion object {
    /** Attached previews, oldest first. Main-thread only (view lifecycle). */
    val attached = ArrayList<SmartSpectraPreviewView>()
  }
}
