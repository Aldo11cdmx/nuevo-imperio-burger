package com.nuevoimperio.burger;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Entrada nativa optimizada para el punto de venta de Nuevo Imperio Burger.
 *
 * Funcionalidades nativas POS:
 * 1) FEATURE_NO_TITLE: Quita por completo la barra de título nativa de la ventana.
 * 2) Orientación adaptativa: Tablets (sw600dp+) fijas en Horizontal (Landscape);
 *    celulares con rotación dinámica (FullSensor).
 * 3) Inmersión total (Fullscreen / Edge-to-Edge) con barras transparentes.
 * 4) FLAG_KEEP_SCREEN_ON: mantiene la pantalla activa durante todo el turno.
 * 5) BridgeWebViewClient intercepción para esquemas intent:// y posprinterdriver:// hacia POS Printer Driver.
 */
public class MainActivity extends BridgeActivity {

    private void hideSystemBars() {
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(getWindow(), decor);
            if (controller != null) {
                controller.setSystemBarsBehavior(
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.statusBars()
                        | WindowInsetsCompat.Type.navigationBars());
            }
        } else {
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
        // Registra el plugin ThermalPrinter ANTES de super.onCreate
        registerPlugin(ThermalPrinterPlugin.class);

        // Quita la barra de título nativa de la ventana de Android
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        // Orientación adaptativa según formato de pantalla (Tablet vs Smartphone)
        boolean isTablet = getResources().getBoolean(R.bool.is_tablet);
        if (isTablet) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
        }

        // Oculta la barra de estado y pone la app en pantalla completa
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Barras transparentes para ocupar el 100% del display
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();

        super.onCreate(savedInstanceState);

        // Intercepta esquemas intent:// y posprinterdriver:// usando BridgeWebViewClient de Capacitor
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    if (url != null && (url.startsWith("intent://") || url.startsWith("posprinterdriver://"))) {
                        try {
                            Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                            if (intent != null) {
                                startActivity(intent);
                                return true;
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                        return true; // Evita que la WebView intente cargar la URL y marque error
                    }
                    return super.shouldOverrideUrlLoading(view, url);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        android.net.Uri uri = request.getUrl();
                        if (uri != null) {
                            String url = uri.toString();
                            if (url.startsWith("intent://") || url.startsWith("posprinterdriver://")) {
                                try {
                                    Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                                    if (intent != null) {
                                        startActivity(intent);
                                        return true;
                                    }
                                } catch (Exception e) {
                                    e.printStackTrace();
                                }
                                return true;
                            }
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    /**
     * Auxiliar nativo para envío directo de comandos ESC/POS a impresoras térmicas
     * por socket de red local (ej. puerto 9100) sin abrir el diálogo del sistema.
     */
    public static void printRawEscPos(final String ip, final int port, final byte[] data) {
        new Thread(() -> {
            try (java.net.Socket socket = new java.net.Socket(ip, port)) {
                java.io.OutputStream out = socket.getOutputStream();
                out.write(data);
                out.flush();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();
    }
}
