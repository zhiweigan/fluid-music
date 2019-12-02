const should = require('should');
const mocha = require('mocha');
const tab = require('../src/tab');

const q = 1/4;  // quarter note
const e = 1/8;  // eighth note
const s = 1/16; // sixteenth note

describe('tab.parseRhythm', () => {
  it(`should parse '1 2 ' as four eighth notes`, () => {
    tab.parseRhythm('1 2 ').should.deepEqual([1/8,2/8,3/8,4/8]);
  });
  it(`should parse '1   2 ' as four sixteenth and two eighths`, () => {
    tab.parseRhythm('1   2 ').should.deepEqual([s,s*2,s*3,s*4,3/8,4/8]);
  });
  it(`should parse '1234' as four quarter notes`, () => {
    tab.parseRhythm('1234').should.deepEqual([1/4,2/4,3/4,1]);
  });
  it(`should parse '1..2..' as triplets`, () => {
    const t = 1/4/3; // eighth note triplets
    tab.parseRhythm('1..2..').should.deepEqual([1*t,2*t,3*t,4*t,5*t,6*t]);
  });
});

describe('tab.rhythmToAdvanceArray', () => {
  const eighthRhythm = '1+2+'; 
  it(`should interpret '${eighthRhythm}' as four eighth notes`, () => {
    tab.rhythmToAdvanceArray(eighthRhythm).should.deepEqual([e,e,e,e]);
  });

  it('should output zeros for spaces', () => {
    tab.rhythmToAdvanceArray('1 + ') .should.deepEqual([e, 0, e, 0]);
    tab.rhythmToAdvanceArray('1 + 2').should.deepEqual([e, 0, e, 0, q]);
  });

  const eighthsAndQuarter = '1 + 2 ';
  it(`should interpret '${eighthsAndQuarter}' as two two eighths and a quarter'`, () => {
    tab.rhythmToAdvanceArray(eighthsAndQuarter).should.deepEqual([e, 0, e, 0, q, 0]);
  });

  const sixteenthsRhythm = '1e+a2e+a';
  it(`should interpret '${sixteenthsRhythm}' as sixteenths`, () => {
    tab.rhythmToAdvanceArray(sixteenthsRhythm).should.deepEqual(new Array(8).fill(s));
  });

  const mixedRhythm = '1e+a2+'
  it(`should interpret '${mixedRhythm}' as four sixteenths and two quarters`, () => {
    tab.rhythmToAdvanceArray(mixedRhythm).should.deepEqual([s,s,s,s,e,e]);
  });
});

describe('tab.rhythmToElapsedArray', () => {
  let rhythm     = '1e+a2e+a';
  const desired1 = rhythm.split('').map((letter, i) => (i+1) * 1/16);
  const desired2 = [0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, .4375, 0.5];

  it('manual calculations should match generated', () => {
    desired1.should.deepEqual(desired2);
  });

  it(`should handle ${rhythm}`, () => {
    tab.rhythmToElapsedArray(rhythm).should.deepEqual(desired1);
  });

  it('should handle 1+2+', () => {
    tab.rhythmToElapsedArray('1+2+').should.deepEqual([0.125, 0.25, 0.375, 0.5]);
  });
});

describe('tab.segments', () => {
  it('should work', () => {
    tab.getSegments([1,0,0,0,1,0]).should.deepEqual([[1,0,0,0],[1,0]]);
    tab.getSegments([.1,0,.2,0]).should.deepEqual([[.1,0],[.2,0]]);
  });
});