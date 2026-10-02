package com.trekov.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.trekov.app.nav.TrekovNavPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Trekov's own plugins live in this app rather than in npm packages.
        registerPlugin(TrekovNavPlugin.class);
        registerPlugin(TrekovAppPlugin.class);
        registerPlugin(TrekovSafetyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
