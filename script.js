const popSound = document.getElementById('pop-sound');
const multiPopSound = document.getElementById('multi-pop-sound');
const warningSound = document.getElementById('warning-sound');
const warningSoundReverse = document.getElementById('warning-sound-reverse');
const warningSoundDeny = document.getElementById('warning-sound-deny');
const loseSound = document.getElementById('lose-sound');
const winSound = document.getElementById('win-sound');
const newSound = document.getElementById('new-sound');

winSound.volume = 0.55;

let fieldSize = 5;
const MINE_RATIO = 0.12;

let timerInterval = null;



const LONG_PRESS_MS = 300;
const SHARDS_PER_BUBBLE = 6;

// Regular <audio> elements can't play backwards (no negative playbackRate
// support), so the warning sound is decoded into a Web Audio buffer once,
// then played forwards (flagging) or from a reversed copy (unflagging).
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioContextClass();
let warningBufferPromise = null;
let reversedWarningBuffer = null;
let flagCounter = 0;
let elapsedTime = 0;
let shouldBeTiming = false;
let isFirstClick = true;
let isMuted = false;

// Central place all one-shot sound effects go through, so muting can be
// enforced in a single spot instead of guarding every call site.
const playSound = (audioElement) => {
  if (isMuted) return;
  const sound = audioElement.cloneNode();
  sound.play();
};

// --- Seamless background music (single combined track, native loop points) ---
// bgm-intro.mp3 and bgm-loop.mp3 used to be separate files, each with its own
// MP3 encoder delay/padding silence (visible in their iTunSMPB metadata) that
// browsers' decodeAudioData() doesn't strip - that hidden silence was the
// real source of the audible gap, even with sample-accurate scheduling
// between two sources. bgm-full.wav is a single, pre-trimmed, losslessly
// concatenated file (intro immediately followed by the loop section, no
// codec artifacts in between) so one AudioBufferSourceNode can just loop
// natively between two points within it - no gap, no scheduling math.
const MUSIC_VOLUME = 0.75;
const musicGain = audioContext.createGain();
musicGain.connect(audioContext.destination);
musicGain.gain.value = MUSIC_VOLUME;

// Exact loop boundaries within bgm-full.wav, derived from the song's own
// tempo and structure (2 bars of intro, 16 bars of loop, at 98 BPM) rather
// than a fixed sample count - this is sample-rate independent, so it keeps
// working correctly even if bgm-full.wav gets re-exported at a different
// sample rate or bit depth. It only breaks if the musical structure itself
// changes (extra bars, added lead-in silence, a different tempo, etc).
const SONG_BPM = 98;
const BEATS_PER_BAR = 4;
const SECONDS_PER_BAR = (60 / SONG_BPM) * BEATS_PER_BAR;
const INTRO_BARS = 2;
const TOTAL_BARS = 18; // 2 bars intro + 16 bars loop
const LOOP_START_SECONDS = INTRO_BARS * SECONDS_PER_BAR;
const LOOP_END_SECONDS = TOTAL_BARS * SECONDS_PER_BAR;

let musicBuffer = null;
let musicSource = null;

const musicBufferPromise = fetch('bgm-full.mp3')
  .then((response) => response.arrayBuffer())
  .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
  .then((buffer) => {
    musicBuffer = buffer;
  });

// Stops and disconnects the currently-playing music source, if any, so a
// new game can start fresh (buffer sources are one-shot - once stopped they
// can't be restarted, a new source node has to be created each time).
const stopMusicSource = () => {
  if (!musicSource) return;
  try {
    musicSource.stop();
  } catch (error) {
    // Already stopped/ended - nothing to do.
  }
  musicSource.disconnect();
  musicSource = null;
};

// Starts (or restarts) the music from the very beginning (the intro), then
// loops forever between the end of the intro and the end of the file -
// natively, within a single buffer, so there's no gap or seam. Ignored
// failures (e.g. blocked autoplay before any user gesture) are swallowed
// since the very first startNewGame() call runs on page load.
const startMusic = async () => {
  stopMusicSource();
  await musicBufferPromise;

  // Autoplay policies can leave the context suspended until a user gesture.
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {});
  }

  musicSource = audioContext.createBufferSource();
  musicSource.buffer = musicBuffer;
  musicSource.loop = true;
  musicSource.loopStart = LOOP_START_SECONDS;
  musicSource.loopEnd = LOOP_END_SECONDS;
  musicSource.connect(musicGain);
  musicSource.start();
};

const stopMusic = () => {
  stopMusicSource();
};



// Plays the warning sound forwards when flagging, or reversed when unflagging.
const playWarningSound = async (reverse) => {
  if (!reverse) {
    playSound(warningSound);
    return;
  }
  playSound(warningSoundReverse);
};

// Loads debug.css (which visually flags mines) when ?debug=1 is in the URL.
const params = new URLSearchParams(window.location.search);
if (params.get('debug') === '1') {
  const debugStyles = document.createElement('link');
  debugStyles.rel = 'stylesheet';
  debugStyles.href = 'debug.css';
  document.head.appendChild(debugStyles);
}

// Randomly marks a subset of the already-created bubbles as mines by
// shuffling their indices and tagging the first mineCount of them.
const distributeMines = (wraps) => {
  const mineCount = Math.round(wraps.length * MINE_RATIO);
  flagCounter = mineCount;
  updateFlagField();

  const indices = wraps.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  indices.slice(0, mineCount).forEach((index) => {
    wraps[index].classList.add('mine');
  });
};

// Called when the player's very first click of the game lands on a mine.
// Rather than ending the game immediately, the mine is moved to a random
// other (currently non-mine) bubble, and the neighbor-count labels are
// recalculated so the board stays consistent. This guarantees the first
// click is always safe.
const relocateMine = (wraps, size, clickedWrap) => {
  clickedWrap.classList.remove('mine');

  const candidates = wraps.filter(
    (wrap) => wrap !== clickedWrap && !wrap.classList.contains('mine')
  );
  if (candidates.length > 0) {
    const newMineWrap = candidates[Math.floor(Math.random() * candidates.length)];
    newMineWrap.classList.add('mine');
  }

  labelMineCounts(wraps, size);
};

// For every non-mine bubble, count how many of its 8 neighbors are mines
// and render that count as a label (shown once the bubble is popped). Safe
// to call more than once (e.g. after relocateMine) - any labels/counts from
// a previous call are cleared first.
const labelMineCounts = (wraps, size) => {
  wraps.forEach((wrap) => {
    const existingLabel = wrap.querySelector('.count');
    if (existingLabel) existingLabel.remove();
    delete wrap.dataset.count;
  });

  const isMine = (row, col) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return false;
    return wraps[row * size + col].classList.contains('mine');
  };

  wraps.forEach((wrap, index) => {
    if (wrap.classList.contains('mine')) return;

    const row = Math.floor(index / size);
    const col = index % size;
    let count = 0;

    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        if (isMine(row + dr, col + dc)) count += 1;
      }
    }

    // Always store the count (even 0) so the flood-fill reveal below can read it.
    wrap.dataset.count = count;

    if (count > 0) {
      const label = document.createElement('span');
      label.className = 'count';
      label.dataset.count = count;
      label.textContent = count;
      wrap.appendChild(label);
    }
  });
};

// Returns the (bounds-checked) flat-array indices of a cell's 8 neighbors.
const getNeighborIndices = (index, size) => {
  const row = Math.floor(index / size);
  const col = index % size;
  const neighbors = [];

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nRow = row + dr;
      const nCol = col + dc;
      if (nRow < 0 || nRow >= size || nCol < 0 || nCol >= size) continue;
      neighbors.push(nRow * size + nCol);
    }
  }

  return neighbors;
};

// Classic minesweeper flood fill: reveals the given cell, and if it has no
// adjacent mines, keeps expanding into its neighbors (revealing numbered
// bubbles as boundaries, but not expanding past them). Flagged bubbles are
// left untouched so the player's flags aren't overridden.
const revealCascade = (wraps, size, startIndex) => {
  const stack = [startIndex];
  const visited = new Set();
  let additionalReveals = 0; // bubbles revealed beyond the one the user clicked

  while (stack.length > 0) {
    const index = stack.pop();
    if (visited.has(index)) continue;
    visited.add(index);

    const wrap = wraps[index];
    if (wrap.classList.contains('mine') || wrap.classList.contains('flagged')) continue;

    const cellBubble = wrap.querySelector('.bubble');
    if (!cellBubble.checked) additionalReveals += 1;
    cellBubble.checked = true;
    // Marks the bubble as permanently popped so it can't be unchecked later.
    wrap.classList.add('popped');

    if (wrap.dataset.count !== '0') continue; // numbered cell: reveal but don't expand

    getNeighborIndices(index, size).forEach((neighborIndex) => {
      if (!visited.has(neighborIndex)) stack.push(neighborIndex);
    });
  }

  // If the cascade spread past the clicked bubble, play a distinct sound
  // for revealing multiple bubbles at once.
  if (additionalReveals > 0) {
    playSound(multiPopSound);
  }
};
const container = document.querySelector('.bubblewrap-container');
const gameMessage = document.getElementById('game-message');
const FIELD_HOLDER_SIZE = 380;

// Scales the (possibly much larger) grid down so it always visually fits
// within a 380x380 box, regardless of field size, while staying centered
// (the flex-centering on .field-holder plus a center transform-origin keep
// it positioned correctly as it shrinks).
const fitContainerToHolder = () => {
  container.style.transform = 'none';
  const naturalWidth = container.offsetWidth;
  const naturalHeight = container.offsetHeight;
  const scale = Math.min(
    FIELD_HOLDER_SIZE / naturalWidth,
    FIELD_HOLDER_SIZE / naturalHeight,
    1
  );
  container.style.transform = `scale(${scale})`;
};

const setGameMessage = (text, variant) => {
  gameMessage.textContent = text;
  gameMessage.className = variant ? `game-message ${variant}` : 'game-message';
};

// Ends the game after a mine is popped: plays the lose sound, reveals every
// mine on the board, and locks the grid so no more bubbles can be interacted with.
const triggerGameOver = () => {
  stopTimer();
  stopMusic();
  playSound(loseSound);

  bubbleWraps.forEach((wrap) => {
    if (wrap.classList.contains('mine')) {
      wrap.classList.add('revealed-mine');
    }
  });

  container.classList.add('game-over');
  setGameMessage('Game Over!', 'lose');
};

// A win happens when every non-mine bubble has been popped.
const checkWinCondition = () => {
  updateFlagField();

  const allNonMinesRevealed = bubbleWraps.every((wrap) => {
    if (wrap.classList.contains('mine')) return true;
    return wrap.querySelector('.bubble').checked;
  });

  if (allNonMinesRevealed) {
    triggerWin();
  }
};

// Celebrates the win: reveals any still-hidden mines (tinted green, not red,
// since nothing exploded) and locks the grid from further interaction.
const triggerWin = () => {
  playSound(winSound);

  stopTimer();
  stopMusic();

  bubbleWraps.forEach((wrap) => {
    if (wrap.classList.contains('mine')) {
      wrap.classList.add('revealed-mine');
    }
  });

  container.classList.add('game-won');
  setGameMessage('You Win!', 'win');
};

const createBubbleWrap = () => {
  const wrap = document.createElement('label');
  wrap.className = 'bubble-wrap';

  const bubble = document.createElement('input');
  bubble.type = 'checkbox';
  bubble.className = 'bubble';
  wrap.appendChild(bubble);

  // Each bubble is wrapped with a few "shard" spans that become the
  // leftover popped-film remnants once the checkbox is checked.
  // for (let i = 0; i < SHARDS_PER_BUBBLE; i += 1) {
  //   const shard = document.createElement('span');
  //   shard.className = 'shard';
  //   wrap.appendChild(shard);
  // }

  return wrap;
};

const wireUpBubble = (wrap, index) => {
  const bubble = wrap.querySelector('.bubble');
  let pressTimer = null;
  let isLongPress = false;

  const toggleFlag = () => {
    // A flag attempt also counts as the first move of the game, just like a
    // click does - so make sure the timer/music start here too.
    startTimer();

    // Already popped bubbles can't be flagged or re-flagged.
    if (bubble.checked) return false;

    const isCurrentlyFlagged = wrap.classList.contains('flagged');

    // Once the flag counter runs out, no more bubbles can be flagged
    // (but existing flags can still be removed).
    if (!isCurrentlyFlagged && flagCounter <= 0) {
      playSound(warningSoundDeny);
      return false;
    }

    const isNowFlagged = wrap.classList.toggle('flagged');
    // Play forwards when flagging, reversed when unflagging.
    playWarningSound(!isNowFlagged);
    if (isNowFlagged) {
      flagCounter -= 1;
    } else {
      flagCounter += 1;
    }
    checkWinCondition();
    return true;
  };

  const startPress = (event) => {
    // Right-clicks are handled by the contextmenu listener below, not a long press.
    if (event.button !== undefined && event.button !== 0) return;
    if (bubble.checked) return;

    isLongPress = false;
    pressTimer = setTimeout(() => {
      // A long press always means the user intended to flag/unflag, not pop -
      // so the upcoming click is swallowed even if the flag attempt was denied
      // (e.g. no flags left). Otherwise they'd risk accidentally popping a mine.
      isLongPress = true;
      toggleFlag();
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    clearTimeout(pressTimer);
  };

  wrap.addEventListener('pointerdown', startPress);
  wrap.addEventListener('pointerup', cancelPress);
  wrap.addEventListener('pointerleave', cancelPress);
  wrap.addEventListener('pointercancel', cancelPress);

  // Right click also flags/unflags the bubble, same as a long press.
  wrap.addEventListener('contextmenu', (event) => {
    event.preventDefault();

    // On touch devices, holding a bubble long enough fires our own
    // timer-based long-press toggle first, then the browser follows up
    // with its own synthetic contextmenu event for that same gesture. If
    // we didn't skip it here, that one press would flag and then
    // immediately un-flag the bubble. A true right-click never triggers
    // the timer (see the button check in startPress), so isLongPress is
    // only ever true here because of that touch case.
    if (isLongPress) return;

    toggleFlag();
  });

  bubble.addEventListener('click', (event) => {
    startTimer();

    if (isLongPress) {
      // The long press already toggled the flag; don't let this click pop it too.
      event.preventDefault();
      isLongPress = false;
      return;
    }

    if (wrap.classList.contains('popped')) {
      // Once popped, a bubble is permanently revealed - block un-popping it.
      event.preventDefault();
      return;
    }

    if (wrap.classList.contains('flagged')) {
      // Flagged bubbles must be unflagged (long press) before they can be popped.
      event.preventDefault();
    }
  });

  bubble.addEventListener('change', () => {
    if (bubble.checked) {
      wrap.classList.add('popped');

      // The first click of the game is always guaranteed safe: if it landed
      // on a mine, relocate that mine elsewhere before checking.
      if (isFirstClick) {
        isFirstClick = false;
        if (wrap.classList.contains('mine')) {
          relocateMine(bubbleWraps, fieldSize, wrap);
        }
      }

      if (wrap.classList.contains('mine')) {
        triggerGameOver();
        return;
      }

      playSound(popSound);

      revealCascade(bubbleWraps, fieldSize, index);
      checkWinCondition();
    }
  });
};

const bubbleWraps = [];

const startNewGame = () => {
  shouldBeTiming = false;
  elapsedTime = 0;
  updateTimerField();
  isFirstClick = true;

  // Clear out any bubbles from a previous game.
  container.innerHTML = '';
  container.classList.remove('game-over', 'game-won');
  setGameMessage('');
  bubbleWraps.length = 0;

  // Let the CSS grid know how many columns/rows to lay out.
  container.style.setProperty('--field-size', fieldSize);

  for (let i = 0; i < fieldSize * fieldSize; i += 1) {
    const wrap = createBubbleWrap();
    container.appendChild(wrap);
    wireUpBubble(wrap, i);
    bubbleWraps.push(wrap);
  }

  ['tape1', 'tape2', 'tape3', 'tape4'].forEach((tapeClass) => {
    const tape = document.createElement('div');
    tape.className = `tape ${tapeClass}`;
    container.appendChild(tape);
  });

  distributeMines(bubbleWraps);
  labelMineCounts(bubbleWraps, fieldSize);
  fitContainerToHolder();
};

const newGameButton = document.getElementById('new-game-button');
newGameButton.addEventListener('click', () => {
  startNewGame();
  playSound(newSound);
  stopMusic();
});

const fieldSizeInput = document.getElementById('field-size-input');
const fieldSizeDecrement = document.getElementById('field-size-decrement');
const fieldSizeIncrement = document.getElementById('field-size-increment');
const FIELD_SIZE_MIN = parseInt(fieldSizeInput.min, 10);
const FIELD_SIZE_MAX = parseInt(fieldSizeInput.max, 10);

fieldSizeInput.value = String(fieldSize);

const applyFieldSize = (value) => {
  const clamped = Math.min(FIELD_SIZE_MAX, Math.max(FIELD_SIZE_MIN, value));
  fieldSizeInput.value = String(clamped);
  fieldSize = clamped;
  startNewGame();
  playSound(newSound);
  stopMusic();
};

fieldSizeInput.addEventListener('change', () => {
  const parsed = parseInt(fieldSizeInput.value, 10);
  applyFieldSize(Number.isNaN(parsed) ? fieldSize : parsed);
});

fieldSizeDecrement.addEventListener('click', () => {
  applyFieldSize(parseInt(fieldSizeInput.value, 10) - 1);
});

fieldSizeIncrement.addEventListener('click', () => {
  applyFieldSize(parseInt(fieldSizeInput.value, 10) + 1);
});

const muteCheckbox = document.getElementById('mute-audio');
isMuted = muteCheckbox.checked;
muteCheckbox.addEventListener('change', () => {
  isMuted = muteCheckbox.checked;
  if (!isMuted) {
    playSound(newSound);
  }
});

const muteMusicCheckbox = document.getElementById('mute-music');
musicGain.gain.value = muteMusicCheckbox.checked ? 0 : MUSIC_VOLUME;
muteMusicCheckbox.addEventListener('change', () => {
  musicGain.gain.value = muteMusicCheckbox.checked ? 0 : MUSIC_VOLUME;
  playSound(newSound);
});

const formatNumber = (num) => {
  return num.toString().padStart(3, '0');
};

const updateFlagField = () => {
  const flagCounterLabel = document.getElementById('flag-counter');
  flagCounterLabel.textContent = formatNumber(flagCounter);
};

const updateTimerField = () => {
  const timerLabel = document.getElementById('elapsed-time');
  timerLabel.textContent = formatNumber(elapsedTime);
};

const startTimer = () => {
  // Guard against multiple overlapping intervals: if the timer is already
  // running (e.g. from an earlier click this game), don't start another one
  // or reset the elapsed count back to 0.
  if (shouldBeTiming) return;

  shouldBeTiming = true;
  startMusic();
  timerInterval = setInterval(() => {
    if (!shouldBeTiming) {
      clearInterval(timerInterval);
      return;
    }
    elapsedTime++;
    updateTimerField();
  }, 1000);
};

const stopTimer = () => {
  shouldBeTiming = false;
  clearInterval(timerInterval);
};

// The game only starts once the player clicks "Start Game" on the welcome
// screen - this both hides the field until then and, crucially, gives us a
// genuine user gesture so the browser allows bg-music to autoplay.
const welcomeScreen = document.getElementById('welcome-screen');
const gameContainer = document.getElementById('game-container');
const startGameButton = document.getElementById('start-game-button');

startGameButton.addEventListener('click', () => {
  welcomeScreen.classList.add('hidden');
  gameContainer.classList.remove('hidden');
  startNewGame();
});
