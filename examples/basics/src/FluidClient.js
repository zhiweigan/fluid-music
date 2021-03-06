const dgram = require('dgram');
const osc = require('osc-min');

/**
 * FluidOscSender will close instantly after all messages were sent.
 */
module.exports = class FluidOscSender {
  constructor(targetPort) {
    if (typeof targetPort !== 'number') targetPort = 9999;
    this.targetPort = targetPort;
    this.pendingMsgCount = 0;
    this.client = dgram.createSocket('udp4');
  }

  /**
   * Send an osc message or bundle.
   * @param {object|object[]|Buffer} msgObject - The osc message to be sent.
   *        If the type is:
   *          - object - parse it with the osc-min npm module
   *          - object[] - parse as a bundle. each object is an osc-min message
   *          - Buffer - send the raw buffer
   *        Expects objects to be in the npm osc-min format, which look like:
   *        {
   *          address: '/some/address',
   *          args: [
   *            { type: 'string', value: 'hi there' },
   *            { type: 'integer', value: 100 },
   *            { type: 'float', value: 3.14159 },
   *          ]
   *        }
   * @param {[number]} [timetag = 0] - timetag is only used if first argument is
   *        array.
   */
  send(msgObject, timetag) {
    let buffer;
    if (msgObject instanceof Buffer)
      buffer = msgObject;
    else if (Array.isArray(msgObject))
      buffer = osc.toBuffer({
        oscType: 'bundle',
        timetag: typeof timetag === 'number' ? timetag : 0,
        elements: msgObject });
    else
      buffer = osc.toBuffer(msgObject);

    this.pendingMsgCount++;
    this.client.send(buffer, this.targetPort, (err) => {
      if (err) console.error('Error sending message:', err, msgObject);
      this.pendingMsgCount--;
      if (this.pendingMsgCount === 0) this.client.close();
    });
  }
}