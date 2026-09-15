const popSound = document.getElementById('pop-sound');
const LONG_PRESS_MS = 300;
const SHARDS_PER_BUBBLE = 6;

let fieldSize = 5;

const container = document.querySelector('.bubblewrap-container');

// Let the CSS grid know how many columns/rows to lay out.
container.style.setProperty('--field-size', fieldSize);

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

const wireUpBubble = (wrap) => {
  const bubble = wrap.querySelector('.bubble');
  let pressTimer = null;
  let isLongPress = false;

  const toggleFlag = () => {
    // Already popped bubbles can't be flagged or re-flagged.
    if (bubble.checked) return;
    wrap.classList.toggle('flagged');
  };

  const startPress = (event) => {
    // Right-clicks are handled by the contextmenu listener below, not a long press.
    if (event.button !== undefined && event.button !== 0) return;
    if (bubble.checked) return;

    isLongPress = false;
    pressTimer = setTimeout(() => {
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
      // Clone the node so overlapping pops (rapid clicks) can all play at once
      const sound = popSound.cloneNode();
      sound.play();
    }
  });
};

for (let i = 0; i < fieldSize * fieldSize; i += 1) {
  const wrap = createBubbleWrap();
  container.appendChild(wrap);
  wireUpBubble(wrap);
}
