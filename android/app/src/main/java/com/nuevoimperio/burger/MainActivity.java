package com.nuevoimperio.burger;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Entrada nativa. Dos responsabilidades que el WebView no controla por sí sola:
 *
 * 1) Modo inmersivo real: la barra de estado y la de navegación se ocultan y sólo
 *    reaparecen con un swipe desde el borde. Se reaplica en onWindowFocusChanged
 *    porque Android las vuelve a dibujar cada vez que la ventana vuelve a ganar el
 *    foco.
 *
 * 2) El botón "atrás" hardware se deja en manos de Capacitor: @capacitor/app
 *    reenvía el evento a JS (App.addListener('backButton')), donde la navegación
 *    decide si cerrar un modal/pantalla o pedir confirmación para salir.
 */
public class MainActivity extends BridgeActivity {

    private void hideSystemBars() {
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+: WindowInsetsControllerCompat con 'swipe para mostrar'.
            WindowInsetsControllerCompat controller =
                    new WindowInsetsControllerCompat(getWindow(), decor);
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS);
            controller.hide(WindowInsets.Type.statusBar()
                    | WindowInsets.Type.navigationBar());
        } else {
            // API 24-29: flag clásico inmersivo. Se reinicia al perder el foco.
            int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            decor.setSystemUiVisibility(flags);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Que el contenido se dibuje detrás de las barras; el inmersivo las oculta.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Tras cualquier interrupción (diálogo, gesto, encendido de pantalla) las
        // barras vuelven a aparecer: forzamos el estado inmersivo al recuperar el foco.
        if (hasFocus) hideSystemBars();
    }
}
