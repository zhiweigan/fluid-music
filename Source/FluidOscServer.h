/*
  ==============================================================================

    FluidOscServer.h
    Created: 18 Nov 2019 5:50:15pm
    Author:  Charles Holbrow

  ==============================================================================
*/

#pragma once
#include <iostream>
#include "../JuceLibraryCode/JuceHeader.h"
#include "cybr_helpers.h"
#include "CybrEdit.h"
#include "CybrSearchPath.h"
#include "temp_OSCInputStream.h"

typedef void (*OscHandlerFunc)(const OSCMessage&);

struct SelectedObjects {
    te::AudioTrack* audioTrack = nullptr;
    te::Clip* clip = nullptr;
    te::Plugin* plugin = nullptr;
};

class FluidOscServer :
    public OSCReceiver,
    private OSCReceiver::Listener<OSCReceiver::MessageLoopCallback>
{
public:
    FluidOscServer();
    
    virtual void oscMessageReceived (const OSCMessage& message) override;
    virtual void oscBundleReceived (const OSCBundle& bundle) override;
    
    void handleOscBundle(const OSCBundle& bundle, SelectedObjects parentSelection);
    void handleOscMessage(const OSCMessage& message);

    // message handlers
    void selectAudioTrack(const OSCMessage& message);
    void removeAudioTrackClips(const OSCMessage& message);
    void selectReturnTrack(const OSCMessage& message);
    void selectMidiClip(const OSCMessage& message);
    void selectPlugin(const OSCMessage& message);
    void setPluginParam(const OSCMessage& message);
    void setPluginParamAt(const OSCMessage& message);
    void setPluginSideChainInput(const OSCMessage& message);
    void savePluginPreset(const OSCMessage& message);
    void loadPluginPreset(const OSCMessage& message);
    void loadPluginTrkpreset(const OSCMessage& message);
    void ensureSend(const OSCMessage& message);
    void clearMidiClip(const OSCMessage& message);
    void insertMidiNote(const OSCMessage& message);
    void insertWaveSample(const OSCMessage& message);
    void saveActiveEdit(const OSCMessage& message);
    void activateEditFile(const OSCMessage& message);
    void changeWorkingDirectory(const OSCMessage& message);
    void handleSamplerMessage(const OSCMessage& message);
    void handleTransportMessage(const OSCMessage& message);
    void setTrackGain(const OSCMessage& message);
    void renderRegion(const OSCMessage& message);
    void renderClip(const OSCMessage& message);
    void setClipLength(const OSCMessage& message);
    void trimClipBySeconds(const OSCMessage& message);
    void selectClip(const OSCMessage& message);
    void offsetClipSourceInSeconds(const OSCMessage& message);
    void audioClipFadeInOutSeconds(const OSCMessage& message);
    void setClipDb(const OSCMessage& message);

    // everything else
    void muteTrack(bool mute);
    void reverseAudioClip(bool reverse);
    void activateEditFile(File file, bool forceEmptyEdit = false);
    std::unique_ptr<CybrEdit> activeCybrEdit = nullptr;

private:

    /** Recursively handle all messages and nested bundles, reseting the
     selection state to parentSelection after each bundle. This should ensure
     that nested bundles do not leave behind a selection after they have been
     handled. */

    te::AudioTrack* selectedAudioTrack = nullptr;
    te::Clip* selectedClip = nullptr;
    te::Plugin* selectedPlugin = nullptr;
};

class FluidIpc : public InterprocessConnection{
public:
    void connectionMade() override;
    void connectionLost() override;
    void messageReceived(const MemoryBlock& message) override;
    
    void setFluidServer(FluidOscServer& server);
private:
    FluidOscServer* fluidserver = nullptr;
};

class FluidIpcServer : public InterprocessConnectionServer{
public:
    FluidIpcServer(FluidOscServer& server);
    InterprocessConnection* createConnectionObject() override;
    
private:
    int ipc_num = 0;
    std::map<int, FluidIpc> ipcMap;
    FluidOscServer* serverRef = nullptr;
};
