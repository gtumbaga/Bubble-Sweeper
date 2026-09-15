const popSound = document.getElementById('pop-sound');
const multiPopSound = document.getElementById('multi-pop-sound');
const warningSound = document.getElementById('warning-sound');
const warningSoundReverse = document.getElementById('warning-sound-reverse');
const warningSoundDeny = document.getElementById('warning-sound-deny');
const loseSound = document.getElementById('lose-sound');
const winSound = document.getElementById('win-sound');
const newSound = document.getElementById('new-sound');



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



// Plays the warning sound forwards when flagging, or reversed when unflagging.
const playWarningSound = async (reverse) => {

  if (!reverse) {
    const sound = warningSound.cloneNode();
    sound.play();
    return;
  }
  const reversed = warningSoundReverse.cloneNode();
  reversed.play();
  return;

};

// Loads debug.css (which visually flags mines) when ?debug=1 is in the URL.
const params = new URLSearchParams(window.location.search);
if (params.get('debug') === '1') {
  const debugStyles = document.createElement('link');
  debugStyles.rel = 'stylesheet';
  debugStyles.href = 'debug.css';
  document.head.appendChild(debugStyles);
}

let fieldSize = 6;
const MINE_RATIO = 0.15;

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

// For every non-mine bubble, count how many of its 8 neighbors are mines
// and render that count as a label (shown once the bubble is popped).
const labelMineCounts = (wraps, size) => {
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

    if (wrap.dataset.count !== '0') continue; // numbered cell: reveal but don't expand

    getNeighborIndices(index, size).forEach((neighborIndex) => {
      if (!visited.has(neighborIndex)) stack.push(neighborIndex);
    });
  }

  // If the cascade spread past the clicked bubble, play a distinct sound
  // for revealing multiple bubbles at once.
  if (additionalReveals > 0) {
    const sound = multiPopSound.cloneNode();
    sound.play();
  }
};
const container = document.querySelector('.bubblewrap-container');
const gameMessage = document.getElementById('game-message');

const setGameMessage = (text, variant) => {
  gameMessage.textContent = text;
  gameMessage.className = variant ? `game-message ${variant}` : 'game-message';
};

// Ends the game after a mine is popped: plays the lose sound, reveals every
// mine on the board, and locks the grid so no more bubbles can be interacted with.
const triggerGameOver = () => {
  const sound = loseSound.cloneNode();
  sound.play();

  bubbleWraps.forEach((wrap) => {
    if (wrap.classList.contains('mine')) {
      wrap.classList.add('revealed-mine');
    }
  });

  container.classList.add('game-over');
  setGameMessage('Game Over! You popped a mine.', 'lose');
};

// A win happens when every non-mine bubble has been popped, or every mine
// has been flagged (whichever comes first).
const checkWinCondition = () => {
  updateFlagField();

  const mineWraps = bubbleWraps.filter((wrap) => wrap.classList.contains('mine'));

  const allNonMinesRevealed = bubbleWraps.every((wrap) => {
    if (wrap.classList.contains('mine')) return true;
    return wrap.querySelector('.bubble').checked;
  });

  const allMinesFlagged =
    mineWraps.length > 0 && mineWraps.every((wrap) => wrap.classList.contains('flagged'));

  if (allNonMinesRevealed || allMinesFlagged) {
    triggerWin();
  }
};

// Celebrates the win: reveals any still-hidden mines (tinted green, not red,
// since nothing exploded) and locks the grid from further interaction.
const triggerWin = () => {
  const sound = winSound.cloneNode();
  sound.play();

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
  for (let i = 0; i < SHARDS_PER_BUBBLE; i += 1) {
    const shard = document.createElement('span');
    shard.className = 'shard';
    wrap.appendChild(shard);
  }

  return wrap;
};

const wireUpBubble = (wrap, index) => {
  const bubble = wrap.querySelector('.bubble');
  let pressTimer = null;
  let isLongPress = false;

  const toggleFlag = () => {
    // Already popped bubbles can't be flagged or re-flagged.
    if (bubble.checked) return false;

    const isCurrentlyFlagged = wrap.classList.contains('flagged');

    // Once the flag counter runs out, no more bubbles can be flagged
    // (but existing flags can still be removed).
    if (!isCurrentlyFlagged && flagCounter <= 0) {
      const denySound = warningSoundDeny.cloneNode();
      denySound.play();
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
    toggleFlag();
  });

  bubble.addEventListener('click', (event) => {
    if (isLongPress) {
      // The long press already toggled the flag; don't let this click pop it too.
      event.preventDefault();
      isLongPress = false;
      return;
    }

    if (wrap.classList.contains('flagged')) {
      // Flagged bubbles must be unflagged (long press) before they can be popped.
      event.preventDefault();
    }
  });

  bubble.addEventListener('change', () => {
    if (bubble.checked) {
      if (wrap.classList.contains('mine')) {
        triggerGameOver();
        return;
      }

      // Clone the node so overlapping pops (rapid clicks) can all play at once
      const sound = popSound.cloneNode();
      sound.play();

      revealCascade(bubbleWraps, fieldSize, index);
      checkWinCondition();
    }
  });
};

const bubbleWraps = [];

const startNewGame = () => {
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

  distributeMines(bubbleWraps);
  labelMineCounts(bubbleWraps, fieldSize);
};

const newGameButton = document.getElementById('new-game-button');
newGameButton.addEventListener('click', () => {
  startNewGame();
  const sound = newSound.cloneNode();
  sound.play();
});

const fieldSizeSelector = document.querySelector('.field-size-selector');
fieldSizeSelector.value = String(fieldSize);
fieldSizeSelector.addEventListener('change', () => {
  fieldSize = parseInt(fieldSizeSelector.value, 10);
  startNewGame();
  const sound = newSound.cloneNode();
  sound.play();
});

const formatNumber = (num) => {
  return num.toString().padStart(3, '0');
};

const updateFlagField = () => {
  const flagCounterLabel = document.getElementById('flag-counter');
  flagCounterLabel.textContent = formatNumber(flagCounter);
};

startNewGame();
