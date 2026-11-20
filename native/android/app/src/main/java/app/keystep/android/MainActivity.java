package app.keystep.android;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeystepMidiPlugin.class);
        super.onCreate(savedInstanceState);
        // Practising: don't let the screen sleep.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        handleOpenIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleOpenIntent(intent);
    }

    /** "Open with Keystep" / share a .mid file: pass the bytes to the web app. */
    private void handleOpenIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        final Uri target = uri;
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(target)) {
                if (in == null) return;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0 && out.size() < 20 * 1024 * 1024) out.write(buf, 0, n);
                String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                String name = displayName(target).replace("\\", "\\\\").replace("'", "\\'");
                String js = "(function(){var b=atob('" + b64 + "');var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);"
                        + "var go=function(){if(window.keystepOpenFile){window.keystepOpenFile('" + name + "',u.buffer);}else{setTimeout(go,200);}};go();})();";
                runOnUiThread(() -> { if (getBridge() != null) getBridge().getWebView().evaluateJavascript(js, null); });
            } catch (Exception ignored) { }
        }).start();
    }

    private String displayName(Uri uri) {
        String name = "Song.mid";
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        } catch (Exception ignored) { }
        return name;
    }
}
