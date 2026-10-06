package com.nuevoimperio.burger;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

@CapacitorPlugin(name = "ThermalPrinter")
public class ThermalPrinterPlugin extends Plugin {

    private WebView printWebView; // Referencia fuerte para evitar recolección del GC

    @PluginMethod
    public void print(PluginCall call) {
        String ip = call.getString("ip", "192.168.1.213");
        int port = call.getInt("port", 9100);
        String base64Data = call.getString("data");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("No print data provided");
            return;
        }

        new Thread(() -> {
            Socket socket = null;
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                socket = new Socket();
                socket.connect(new InetSocketAddress(ip, port), 4000); // Timeout de 4 segundos
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                // Comandos ESC/POS estándar: avance de papel (ESC d 4) y corte (GS V 1)
                out.write(new byte[] { 0x1B, 0x64, 0x04 }); // Avanzar 4 líneas
                out.write(new byte[] { 0x1D, 0x56, 0x01 }); // Corte parcial
                out.flush();
                Thread.sleep(100);
                socket.close();
                call.resolve();
            } catch (Exception e) {
                try {
                    if (socket != null) {
                        socket.close();
                    }
                } catch (Exception ignored) {}
                call.reject("Socket TCP print failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void printSystem(PluginCall call) {
        String html = call.getString("html", "");
        getActivity().runOnUiThread(() -> {
            printWebView = new WebView(getContext());
            printWebView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager pm = (PrintManager) getActivity()
                            .getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter("Ticket");
                    if (pm != null) {
                        pm.print("Ticket", adapter, new PrintAttributes.Builder().build());
                        call.resolve();
                    } else {
                        call.reject("PrintManager not available");
                    }
                }
            });
            printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
