import { FluidPlugin } from './plugin'
import { FluidSession } from './FluidSession'
import { FluidTrack } from './FluidTrack'
import { vst2ToReaperObject } from './vst2ToReaperObject'
import * as cybr from './cybr/index';
import { IpcClient } from './cybr/IpcClient'
import { ClipEventContext, MidiNoteEvent, AudioFileEvent } from './fluid-interfaces'
import { is } from 'ramda';

const rppp = require('rppp')

// Reaper appears to store gain as a simple numeric multiplier. I am choosing a
// max value of 12 db. Remember that this is equivalent to voltage gain, so we
// use 20 for the denominator in the equation below. This means that 6.02 db of
// gain is approximately equal to a gain factor of 2. Remember Power=Voltage^2
// which is how the 20 ends up in the db equation instead of 10.
const db2Gain = (db) => Math.pow(10, Math.min(db, 12) / 20)

/**
 * Create a `ReaperProject` from a `FluidSession`
 *
 * WARNING: If the session contains VSTs, the `cybr` server must be running.
 */
export async function sessionToReaperProject(session : FluidSession, client?: IpcClient) {
  if (!session.bpm) throw new Error('Cannot create reaper project: session BPM must be non-zero')

  // If the user does not pass in a client, we will create one automatically. In
  // the event that a client is created automatically, we want to close it
  // close it when then method returns. However, if the user passed in a client,
  // we must not close that client on behalf of the user.
  //
  // Note that we don't want to create the client here, because it may not be
  // needed - it is only used when the session contains one or more VST plugins.
  const closeClientWhenDone = !client
  let tracktionSessionActivated = false

  const reaperProject = new rppp.objects.ReaperProject()
  reaperProject.getOrCreateStructByToken('TEMPO').params = [session.bpm, 4, 4]
  const flatTracks : [FluidTrack, any][] = []

  session.forEachTrack((track, i, ancestors) => {

    const rpppTrack = new rppp.objects.ReaperTrack()
    rpppTrack.getOrCreateStructByToken('NAME').params[0] = track.name

    const volPan = rpppTrack.getOrCreateStructByToken('VOLPAN')
    volPan.params[0] = db2Gain(track.gain)
    volPan.params[1] = track.pan

    // In addition to adding the track to the rppp project, create two parallel
    // arrays. one with the rpp objects, and one with the FluidTrack objects.
    // We'll use these later to get any VSTs.
    reaperProject.addTrack(rpppTrack)
    flatTracks.push([track, rpppTrack])

    // Handle parent/child track groups. Reaper uses a two-element struct to
    // indicate folder structure. The following code is a little convoluted,
    // but it does get the job done. I left notes for how the struct works
    // in the RPPP repo.
    const isBus = [
      0, // 0 = normal, 1 = folder, 2 = folder end
      0 // difference between this level and subsequent track level
    ] as [number, number]
    rpppTrack.getOrCreateStructByToken('ISBUS').params = isBus;
    const atRootLevel = ancestors.length === 0
    const isLastOfLevel = atRootLevel
      ? i === (session.tracks.length - 1)
      : i === (ancestors[ancestors.length - 1].children.length - 1)
    const isLastInArray = (item: any, array: any[]) => {
      return array.length === 0 ? false : (array[array.length - 1] === item)
    }
    if (track.children.length) {
      isBus[0] = 1
      isBus[1] = 1
    } else if (atRootLevel) {
      // do nothing (and use [0, 0])
    } else if (isLastOfLevel && !atRootLevel) {
      isBus[0] = 2
      isBus[1] = -1
      // check how many levels 'up' the next track is
      for (i = ancestors.length - 1; i >= 0; i--) {
        // "aunts" contains the parent's siblings (in order)
        let aunts = i === 0 ? session.tracks : ancestors[i-1].children
        const ancestor = ancestors[i]
        if (isLastInArray(ancestor, aunts)) {
          isBus[1]--
        } else {
          break
        }
      }
    }

    // handle receives (and sends, implicitly)
    track.receives.forEach(receive => {
      // get the absolute index of the sending track
      let index = 0
      let found = false

      session.forEachTrack((track) => {
        if (track === receive.from) return found = true;
        index++
      })

      if (found) {
        rpppTrack.addReceive({
          sourceTrackNumber: index,
          gain: db2Gain(receive.gainDb),
        })
      } else {
        throw new Error(`sessionToReaperProject failed: ${track.name} contained broken receive: ${JSON.stringify(receive)}`)
      }
    })

    // handle Clips
    track.clips.forEach((clip, clipIndex) => {

      // Create one EventContext object for each clip.
      const context = {
        session,
        track,
        clip,
        clipIndex,
        data: {},
        d: {},
      };

      if (clip.midiEvents && clip.midiEvents.length) {
        rpppTrack.contents.push(midiEventsToReaperObject(clip.midiEvents, context));
      }

      if (clip.fileEvents && clip.fileEvents.length) {
        rpppTrack.contents = rpppTrack.contents.concat(fileEventsToReaperObject(clip.fileEvents, context));
      }
    }); // track.clips.forEach

    // Handle track specific automation.
    for (const [name, automation] of Object.entries(track.automation)) {
      let autoObject: any;
      let normalize  = (v) => v;

      if (name === 'gain' || name === 'gainDb') {
        autoObject = new rppp.objects.ReaperVolumeAutomation();
        normalize = db2Gain;
      } else if (name === 'pan') {
        autoObject = new rppp.objects.ReaperPanAutomation();
      } else if (name === 'width') {
        autoObject = new rppp.objects.ReaperWidthAutomation();
      }

      if (!autoObject) {
        throw new Error(`Unsupported reaper track automation lane: "${name}"`);
      }

      automation.points.sort((a, b) => a.startTime - b.startTime)
      for (const autoPoint of automation.points) {
        if (typeof autoPoint.value === 'number') {
          autoObject.addBezierPoint(
            autoPoint.startTime * 4 * 60 / session.bpm,
            normalize(autoPoint.value),
            autoPoint.curve
          );
        }
      }
      rpppTrack.add(autoObject);
    } // for [name, automation] of track.automation
  })  // session.forEachTrack

  // Get VST state info
  for (let i = 0; i < flatTracks.length; i++) {
    const [fluidTrack, rpppTrack] = flatTracks[i]

    // Handle plugins/plugin automation
    const count : any = {};
    const nth = (plugin : FluidPlugin) => {
      const str = plugin.pluginName + '|' + plugin.pluginType;
      if (!count.hasOwnProperty(str)) count[str] = 0;
      return count[str]++;
    }

    if (fluidTrack.plugins.length > 0) {
      const FXChain = new rppp.objects.ReaperFXChain();
      rpppTrack.add(FXChain);

      for (const plugin of fluidTrack.plugins) {
        if (!client) {
          console.warn('Encountered a VST while creating a Reaper project, but no cybr IcpClient was supplied. A client will be created implicitly.')
          client = new cybr.IpcClient()
          await client.connect(true)
        }
        if (!tracktionSessionActivated) {
          await client.send(cybr.global.activate('reaper-helper.tracktionedit', true))
          tracktionSessionActivated = true
        }
        const vst2 = await vst2ToReaperObject(client, fluidTrack.name, plugin, nth(plugin), session.bpm);
        FXChain.add(vst2);
      } // for (plugin of track.plugins)
    }
  }

  if (client && tracktionSessionActivated && closeClientWhenDone) client.close()

  return reaperProject;
};

function midiEventsToReaperObject(midiEvents : MidiNoteEvent[] , context : ClipEventContext) {
  const bpm = context.session.bpm

  if (typeof context.clip.startTime !== 'number')
    throw new Error('Clip is missing startTime')
  if (typeof bpm !== 'number')
    throw new Error('midiEventsToReaperObject did not find a .bpm in the context')

  const midiItem = new rppp.objects.ReaperItem()
  const clipName  = `${context.track.name} ${context.clipIndex}`
  const startTime = context.clip.startTime
  const duration  = context.clip.duration

  midiItem.getOrCreateStructByToken('NAME').params[0] = clipName
  midiItem.getOrCreateStructByToken('POSITION').params[0] = startTime * 4 * 60 / bpm
  midiItem.getOrCreateStructByToken('LENGTH').params[0] = duration * 4 * 60 / bpm

  const midiArray : any[] = []
  for (const event of midiEvents) {
    const velocity = (typeof event.velocity === 'number')
      ? event.velocity
      : undefined
    midiArray.push({ n: event.note, s: event.startTime, l: event.duration, v: velocity });
  }

  const midiSource = new rppp.objects.ReaperSource()
  midiSource.makeMidiSource()
  midiSource.setMidiNotes(midiArray, duration)
  midiItem.add(midiSource)

  return midiItem;
};

function fileEventsToReaperObject(fileEvents : AudioFileEvent[], context : ClipEventContext) {
  if (typeof context.clip.startTime !== 'number')
    throw new Error('Clip is missing startTime')

  const bpm = context.session.bpm
  if (!bpm) throw new Error('fileEventToReaperObject could not find a session.bpm parameter')

  return fileEvents.map((event, eventIndex) => {
    if (typeof context.clip.startTime !== 'number')
      throw new Error('fileEventsToReaperObject found a clip with no .startTime')

    const startTime = context.clip.startTime + event.startTime

    if (typeof event.path !== 'string') {
      console.error(event);
      throw new Error('tracksToFluidMessage: A file event found in the note library does not have a .path string');
    };

    const audioItem = new rppp.objects.ReaperItem();
    const clipName = `s${context.clipIndex}.${eventIndex}`;
    audioItem.getOrCreateStructByToken('NAME').params[0] = clipName
    audioItem.getOrCreateStructByToken('POSITION').params[0] = startTime * 4 * 60 / bpm

    const audioSource = new rppp.objects.ReaperSource()
    audioSource.makeWaveSource()
    audioSource.getOrCreateStructByToken('FILE').params = [event.path]
    audioItem.add(audioSource)

    if (event.startInSourceSeconds)
      audioItem.getOrCreateStructByToken('SOFFS').params[0] = event.startInSourceSeconds

    if (event.oneShot && event.info && typeof event.info.duration === 'number')
      audioItem.getOrCreateStructByToken('LENGTH').params[0] = event.info.duration - (event.startInSourceSeconds || 0)
    else
      audioItem.getOrCreateStructByToken('LENGTH').params[0] = event.duration * 4 * 60 / bpm

    // apply fade in/out times (if specified)
    if (typeof event.fadeOutSeconds === 'number')
      audioItem.getOrCreateStructByToken('FADEOUT').params = [1, event.fadeOutSeconds, 0, 1, 0, 0]
    if (typeof event.fadeInSeconds === 'number')
      audioItem.getOrCreateStructByToken('FADEIN').params = [1, event.fadeInSeconds, 0, 1, 0, 0]

    // Remember, it is the the final .use call's job to set event.gainDb. The
    // AudioFile technique's .use method looks for a dynamic Object, and sets
    // the event.gainDb property.
    if (typeof event.gainDb === 'number')
      audioItem.getOrCreateStructByToken('VOLPAN').params = [1, 0, db2Gain(event.gainDb), -1]

    return audioItem;
  });
}