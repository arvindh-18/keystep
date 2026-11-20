package app.keystep.android;

import android.content.Context;
import android.content.pm.PackageManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Bridges Android's MIDI service (USB class-compliant keyboards, and Bluetooth
 * MIDI devices once connected) to the Keystep web engine.
 * JS events: "midiMessage" {id, data[], timestamp}, "devicesChanged" {}.
 */
@CapacitorPlugin(name = "KeystepMidi")
public class KeystepMidiPlugin extends Plugin {

    private MidiManager midiManager;
    private Handler handler;
    private final Map<String, MidiDevice> inputDevices = new HashMap<>();
    private final Map<String, List<MidiOutputPort>> inputPorts = new HashMap<>();
    private MidiDevice outputDevice;
    private MidiInputPort outputPort;

    private final MidiManager.DeviceCallback deviceCallback = new MidiManager.DeviceCallback() {
        @Override
        public void onDeviceAdded(MidiDeviceInfo info) {
            notifyListeners("devicesChanged", new JSObject());
        }

        @Override
        public void onDeviceRemoved(MidiDeviceInfo info) {
            String id = String.valueOf(info.getId());
            closeInputInternal(id);
            if (outputDevice != null && outputDevice.getInfo().getId() == info.getId()) closeOutputInternal();
            notifyListeners("devicesChanged", new JSObject());
        }
    };

    @Override
    public void load() {
        HandlerThread thread = new HandlerThread("KeystepMidi");
        thread.start();
        handler = new Handler(thread.getLooper());
        if (getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_MIDI)) {
            midiManager = (MidiManager) getContext().getSystemService(Context.MIDI_SERVICE);
            if (midiManager != null) midiManager.registerDeviceCallback(deviceCallback, handler);
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (String id : new ArrayList<>(inputDevices.keySet())) closeInputInternal(id);
        closeOutputInternal();
        if (midiManager != null) midiManager.unregisterDeviceCallback(deviceCallback);
    }

    private Collection<MidiDeviceInfo> devices() {
        List<MidiDeviceInfo> list = new ArrayList<>();
        if (midiManager == null) return list;
        if (Build.VERSION.SDK_INT >= 33) {
            list.addAll(midiManager.getDevicesForTransport(MidiManager.TRANSPORT_MIDI_BYTE_STREAM));
        } else {
            for (MidiDeviceInfo i : midiManager.getDevices()) list.add(i);
        }
        return list;
    }

    private MidiDeviceInfo find(String id) {
        for (MidiDeviceInfo info : devices()) if (String.valueOf(info.getId()).equals(id)) return info;
        return null;
    }

    private static String nameOf(MidiDeviceInfo info) {
        Bundle p = info.getProperties();
        String name = p.getString(MidiDeviceInfo.PROPERTY_NAME);
        if (name == null || name.isEmpty()) name = p.getString(MidiDeviceInfo.PROPERTY_PRODUCT);
        if (name == null || name.isEmpty()) name = "MIDI device " + info.getId();
        return name;
    }

    @PluginMethod
    public void listDevices(PluginCall call) {
        JSArray arr = new JSArray();
        for (MidiDeviceInfo info : devices()) {
            // Skip our own virtual services and devices with no ports.
            if (info.getInputPortCount() == 0 && info.getOutputPortCount() == 0) continue;
            JSObject o = new JSObject();
            o.put("id", String.valueOf(info.getId()));
            o.put("name", nameOf(info));
            String m = info.getProperties().getString(MidiDeviceInfo.PROPERTY_MANUFACTURER);
            o.put("manufacturer", m == null ? "" : m);
            o.put("inputs", info.getInputPortCount());
            o.put("outputs", info.getOutputPortCount());
            o.put("type", info.getType() == MidiDeviceInfo.TYPE_USB ? "usb" : info.getType() == MidiDeviceInfo.TYPE_BLUETOOTH ? "bluetooth" : "virtual");
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", arr);
        ret.put("supported", midiManager != null);
        call.resolve(ret);
    }

    /** Listen to every output port of a device (device → app). */
    @PluginMethod
    public void openInput(PluginCall call) {
        final String id = call.getString("id");
        if (midiManager == null) { call.reject("MIDI is not supported on this device"); return; }
        if (id == null) { call.reject("Missing id"); return; }
        if (inputDevices.containsKey(id)) { call.resolve(); return; }
        MidiDeviceInfo info = find(id);
        if (info == null) { call.reject("Device not found"); return; }
        midiManager.openDevice(info, device -> {
            if (device == null) { call.reject("Could not open device"); return; }
            inputDevices.put(id, device);
            List<MidiOutputPort> ports = new ArrayList<>();
            for (int i = 0; i < info.getOutputPortCount(); i++) {
                MidiOutputPort port = device.openOutputPort(i);
                if (port != null) {
                    port.connect(new Receiver(id));
                    ports.add(port);
                }
            }
            inputPorts.put(id, ports);
            call.resolve();
        }, handler);
    }

    @PluginMethod
    public void closeInput(PluginCall call) {
        closeInputInternal(call.getString("id", ""));
        call.resolve();
    }

    private void closeInputInternal(String id) {
        List<MidiOutputPort> ports = inputPorts.remove(id);
        if (ports != null) for (MidiOutputPort p : ports) try { p.close(); } catch (IOException ignored) {}
        MidiDevice d = inputDevices.remove(id);
        if (d != null) try { d.close(); } catch (IOException ignored) {}
    }

    /** Open the first input port of a device for sending (app → device). */
    @PluginMethod
    public void openOutput(PluginCall call) {
        String id = call.getString("id");
        if (midiManager == null) { call.reject("MIDI is not supported on this device"); return; }
        MidiDeviceInfo info = id == null ? null : find(id);
        if (info == null || info.getInputPortCount() == 0) { call.reject("Device has no input port"); return; }
        closeOutputInternal();
        midiManager.openDevice(info, device -> {
            if (device == null) { call.reject("Could not open device"); return; }
            outputDevice = device;
            outputPort = device.openInputPort(0);
            if (outputPort == null) call.reject("Port busy"); else call.resolve();
        }, handler);
    }

    @PluginMethod
    public void closeOutput(PluginCall call) {
        closeOutputInternal();
        call.resolve();
    }

    private void closeOutputInternal() {
        if (outputPort != null) try { outputPort.close(); } catch (IOException ignored) {}
        if (outputDevice != null) try { outputDevice.close(); } catch (IOException ignored) {}
        outputPort = null;
        outputDevice = null;
    }

    @PluginMethod
    public void send(PluginCall call) {
        JSArray data = call.getArray("data");
        if (outputPort == null || data == null) { call.resolve(); return; }
        try {
            byte[] bytes = new byte[data.length()];
            for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) data.getInt(i);
            outputPort.send(bytes, 0, bytes.length);
            call.resolve();
        } catch (Exception e) {
            call.reject("Send failed: " + e.getMessage());
        }
    }

    private class Receiver extends MidiReceiver {
        private final String id;
        Receiver(String id) { this.id = id; }

        @Override
        public void onSend(byte[] msg, int offset, int count, long timestamp) {
            JSArray data = new JSArray();
            for (int i = 0; i < count; i++) data.put(msg[offset + i] & 0xFF);
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("data", data);
            o.put("timestamp", timestamp);
            notifyListeners("midiMessage", o);
        }
    }
}
