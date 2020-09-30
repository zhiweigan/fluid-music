const path = require('path')
const fluid = require('fluid-music')
const cybr = fluid.cybr
const nLibrary = require('./n-library')

const tyrellN6 = new fluid.TyrellN6Vst2({
  // Osc Mod
  tyrellSoftSync: 100,

  // Envelope 1
  env1Attack: 0,
  env1Decay: 50,
  env1Sustain: 9.5,
  env1Release: 18,

  // Envelope 2
  env2Attack: 0,
  env2Decay: 23.6,
  env2Sustain: 6,
  env2Release: 20,

  env1Velocity: 0,
  env2Velocity: 80,

  // LP/HP filter
  tyrellCutoff: 60,
  tyrellResonance: 34,
  tyrellKeyFollow: 100,
  tyrellFreqModDepth1: 120,
  tyrellFreqModSrc2: fluid.TyrellN6Vst2.parameterLibrary.tyrellFreqModSrc2.choices.velocity,
  tyrellFreqModDepth2: 18,

  // Oscillators
  tyrellOscVolume1: -30,
  tyrellOscVolume2: -78.5,
  tyrellSubVolume: -91,
  tyrellTune2: 12,

  tyrellShape1: 2.35,
  tyrellShape2: 1.7,

  // Osc Mod
  tyrellPwdepth: 15
})

function fadeInOut (event, context) {
  const eventMapId = 'fadeInOutProcessed'
  if (context.data[eventMapId]) return event
  context.data[eventMapId] = true

  const startTime = 0 // startTime is relative to the Clip
  const endTime = startTime + context.clip.duration
  const midTime = startTime + ((endTime - startTime) / 2)

  const fadeIn = { type: 'trackAuto', paramKey: 'gain', startTime, value: -Infinity, curve: -0.5 }
  const fadeOut = { type: 'trackAuto', paramKey: 'gain', startTime: midTime, value: 0, curve: 0.5 }
  const end = { type: 'trackAuto', paramKey: 'gain', startTime: endTime, value: -Infinity }

  return [event, fadeIn, fadeOut, end]
}

/**
 * @param {Type} event
 * @param  {fluid.ClipEventContext} context
 */
const arp = function (event, context) {
  if (event.type !== 'midiChord') return event
  // fit two arpeggiated ramps inside every quarter note
  const stepSize = 1 / 4 / 2 / event.notes.length
  const numSteps = Math.floor(event.duration / stepSize)
  const result = []

  for (let i = 0; i < numSteps; i++) {
    const n = event.notes[i % event.notes.length]
    const v = 80 - Math.round(60 * i / numSteps)
    const startTime = stepSize * i + event.startTime
    const duration = stepSize
    result.push({ type: 'midiNote', startTime, duration, n, v })
  }
  return result
}

const session = new fluid.FluidSession({
  bpm: 92,
  r: 'hhh',
  nLibrary
}, {
  chords1: { plugins: [tyrellN6] },
  chords2: { plugins: [tyrellN6] },
  chords3: { plugins: [tyrellN6] }
})

const r3 = { r: '123', clips: ['...'] }
const rest6 = { r: 'hhh', clips: ['...'] }

session.insertScore({
  chords1: {
    clips: ['a--', r3, 'd--']
  },
  chords2: {
    clips: [r3, 'b--', r3, 'e--']
  },
  chords3: {
    clips: [rest6, 'c--']
  },
  eventMappers: [arp, fadeInOut]
})

const client = new cybr.Client()
client.connect(true)

const run = async () => {
  // create RPP
  const rpp = await fluid.tracksToReaperProject(session.tracks, 92, client)
  console.log(rpp.dump())

  // send to CYBR
  // const activateMsg = fluid.cybr.global.activate(path.join(__dirname, 'demo-shepherd.tracktionedit'), true)
  // const tracksMsg = fluid.tracksToFluidMessage(session.tracks)
  // const saveMsg = fluid.cybr.global.save()

  // await client.send([activateMsg, tracksMsg, saveMsg])
}

run().finally(() => {
  client.close()
})
