package com.ferrowright.khanakitchen;

import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal Firestore REST writes for code that runs without the web page (message service, notification buttons). */
final class FirestoreRest {
    private FirestoreRest() {}

    private static String documentsRoot() {
        return "projects/" + FirebaseApp.getInstance().getOptions().getProjectId() + "/databases/(default)/documents";
    }

    /**
     * Sets `fields` (strings) and a server timestamp on an existing document. Blocking; call off the main thread.
     * Returns the HTTP status, or -1 if the request never reached Firestore.
     */
    static int update(String docPath, JSONObject stringFields, String timestampField) {
        HttpURLConnection conn = null;
        try {
            JSONObject fields = new JSONObject();
            JSONArray mask = new JSONArray();
            for (java.util.Iterator<String> it = stringFields.keys(); it.hasNext(); ) {
                String key = it.next();
                fields.put(key, new JSONObject().put("stringValue", stringFields.getString(key)));
                mask.put(key);
            }
            JSONObject write = new JSONObject()
                    .put("update", new JSONObject().put("name", documentsRoot() + "/" + docPath).put("fields", fields))
                    .put("updateMask", new JSONObject().put("fieldPaths", mask))
                    .put("currentDocument", new JSONObject().put("exists", true))
                    .put("updateTransforms", new JSONArray().put(new JSONObject()
                            .put("fieldPath", timestampField)
                            .put("setToServerValue", "REQUEST_TIME")));
            byte[] body = new JSONObject().put("writes", new JSONArray().put(write)).toString()
                    .getBytes(StandardCharsets.UTF_8);

            FirebaseOptions options = FirebaseApp.getInstance().getOptions();
            URL url = new URL("https://firestore.googleapis.com/v1/" + documentsRoot() + ":commit?key=" + options.getApiKey());
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            int code = conn.getResponseCode();
            if (code != 200) Log.w("Khana", "Firestore update " + docPath + " failed: HTTP " + code);
            return code;
        } catch (Exception e) {
            Log.w("Khana", "Firestore update " + docPath + " failed", e);
            return -1;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
