// Read a card's rank from its code, e.g. "3H".
function rankOf(card) {
  const rank = card.code[0];
  if (rank === "0") return 10;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  if (rank === "A") return 1;
  return parseInt(rank);
}

function suitOf(card) {
  return card.code[1];
}

function deadwoodValue(card) {
  // Deadwood value is the card's point value; face cards are worth 10 points.
  return Math.min(rankOf(card), 10);
}

function findMelds(hand) {
  // This function finds all possible melds in a hand of cards.
  // A meld is either a set (three or four cards of the same rank) or a run (three or more cards of the same suit in sequence).
  const melds = [];

  // Find sets
  // We'll make a map with all the 2's, 3's, etc.
  // Key will be a rank (e.g., 2), value will be an array with cards of that rank (e.g. 2H, 2D, 2S)
  // Any arrays with 3 or 4 cards are melds.
  const cardsByRank = new Map();
  // go through each card in hand
  for (const card of hand) {
    // get the card's rank
    const rank = rankOf(card);
    // if the rank is not in the map, add it with an empty array
    if (!cardsByRank.has(rank)) {
      cardsByRank.set(rank, []);
    }
    // add the card to the array for that rank
    cardsByRank.get(rank).push(card);
  } // end loop

  // Now go through the map and find array with 3-4 cards of same rank
  // .values() gives us the arrays
  // loop through each array (e.g., ["7C", "7D", "7H"])
  for (const cards of cardsByRank.values()) {
    // if there's 3 cards of the same rank, it's a meld
    if (cards.length === 3) {
      melds.push(cards);
    }
    // if there's 4 cards, add each possible 3 card set as a meld (after adding the 4 card set as a meld)
    if (cards.length === 4) {
      melds.push(cards); // Add the 4-card meld first
      for (let i = 0; i < cards.length; i++) {
        // skip the card at 0, add the other 3 as a meld; skp the card at 1, add the other 3 as a meld; etc.
        const temp = cards.filter((_, index) => index !== i);
        melds.push(temp);
      }
    }
  }

  // Now let's find the runs
  const cardsBySuit = new Map();
  // follow same logic as above to group by suit
  for (const card of hand) {
    const suit = suitOf(card);
    if (!cardsBySuit.has(suit)) {
      cardsBySuit.set(suit, []);
    }
    cardsBySuit.get(suit).push(card);
  }
  // loop over suit groups
  // cards is array of cards of the same suit, e.g., ["3H", "5H", "4H"]
  for (const cards of cardsBySuit.values()) {
    // sort the cards by rank, from lowest to highest, so we can find runs
    // sort compares two cards at a time; if result is negative a comes before b, etc. ['3H', '4H', '5H']
    cards.sort((a, b) => rankOf(a) - rankOf(b));
    // run is the current group of cards we're building
    let run = [];
    for (const card of cards) {
      // if the current run is empty, push the first card onto it to start a new run
      if (run.length === 0) {
        run.push(card);
      }
      // or if this card is exactly one higher than the previous one, add it to the run
      else if (rankOf(card) === rankOf(run[run.length - 1]) + 1) {
        run.push(card);
        // otherwise, we add the current run to melds and start a new run with this card
      } else {
        addRunSubsets(run, melds);
        run = [card];
      }
    }
    addRunSubsets(run, melds);
  }
  return melds;
}

function addRunSubsets(run, melds) {
  // outer loop picks where possible fun starts, inner loop tries endings at least 3 cards later. Slice() makes new array
  for (let start = 0; start <= run.length - 3; start++) {
    for (let end = start + 3; end <= run.length; end++) {
      melds.push(run.slice(start, end));
    }
  }
}

export function bestDeadwood(hand) {
  return bestArrangement(hand).deadwood;
}

// Like bestDeadwood, but also returns which melds and leftover cards give that lowest score.
// Returns { melds: [[card, ...], ...], deadwoodCards: [card, ...], deadwood: number }
export function bestArrangement(hand) {
  const melds = findMelds(hand); // all possible melds in the hand
  let lowestScore = Infinity;
  let bestMelds = []; // the melds used in the best arrangement found so far

  // chosenMelds is the list of melds picked so far on this path through the search
  function search(meldIndex, usedCards, chosenMelds) {
    // meldIndex is index of current meld being considered, usedCards is set of cards already used in previous melds
    if (meldIndex === melds.length) {
      // we've considered all melds
      const deadwood = hand // start with whole hand
        .filter((card) => !usedCards.has(card)) // remove cards that are in melds
        .reduce((total, card) => total + deadwoodValue(card), 0); // sum up values of remaining cards
      // only a strictly lower score replaces the best, so on ties the first arrangement found is kept
      if (deadwood < lowestScore) {
        lowestScore = deadwood;
        bestMelds = chosenMelds;
      }
      return;
    }

    // choice 1:skip the current meld
    search(meldIndex + 1, usedCards, chosenMelds);

    // Choice 2: use this meld, if it doesn't overlap.
    const meld = melds[meldIndex];
    const overlaps = meld.some((card) => usedCards.has(card));

    if (!overlaps) {
      const nextUsedCards = new Set(usedCards);

      for (const card of meld) {
        nextUsedCards.add(card);
      }

      // [...chosenMelds, meld] makes a new array, so other paths aren't affected
      search(meldIndex + 1, nextUsedCards, [...chosenMelds, meld]);
    }
  } // end search
  search(0, new Set(), []);

  const meldedCards = new Set(bestMelds.flat());
  const deadwoodCards = hand.filter((card) => !meldedCards.has(card));
  return { melds: bestMelds, deadwoodCards, deadwood: lowestScore };
} // end bestArrangement

// A meld is a set if all its cards share a rank; otherwise it's a run.
function isSet(meld) {
  return meld.every((card) => rankOf(card) === rankOf(meld[0]));
}

// Can this card be added to this meld?
function fitsMeld(card, meld) {
  if (isSet(meld)) {
    // a set holds at most 4 cards
    return meld.length < 4 && rankOf(card) === rankOf(meld[0]);
  }
  if (suitOf(card) !== suitOf(meld[0])) return false;
  const ranks = meld.map(rankOf);
  // a run can grow one rank below its lowest card or one above its highest
  return (
    rankOf(card) === Math.min(...ranks) - 1 ||
    rankOf(card) === Math.max(...ranks) + 1
  );
}

// After a knock, the opponent lays off deadwood cards onto the knocker's melds.
// No lay-off is allowed when the knocker has gin (0 deadwood).
// Returns { deadwood: number, laidOff: [card, ...], remaining: [card, ...] }
export function deadwoodAfterLayoff(knockerHand, opponentHand) {
  const knocker = bestArrangement(knockerHand);
  const opponent = bestArrangement(opponentHand);
  let remaining = [...opponent.deadwoodCards];
  const laidOff = [];

  if (knocker.deadwood > 0) {
    // copy the melds so the knocker's real melds aren't changed
    const melds = knocker.melds.map((meld) => [...meld]);
    let changed = true;
    // a laid-off card can make room for another, so repeat until nothing fits
    while (changed) {
      changed = false;
      for (const card of remaining) {
        const meld = melds.find((m) => fitsMeld(card, m));
        if (meld) {
          meld.push(card);
          laidOff.push(card);
          remaining = remaining.filter((c) => c !== card);
          changed = true;
          break; // remaining changed, so start the pass again
        }
      }
    }
  }

  const deadwood = remaining.reduce((t, card) => t + deadwoodValue(card), 0);
  return { deadwood, laidOff, remaining };
}

const GIN_BONUS = 25;
const UNDERCUT_BONUS = 25;

// Scores a finished hand. Both arguments are deadwood point totals; the
// opponent's should already have lay-offs applied.
// Returns { winner: "knocker" | "opponent", points: number, result: "gin" | "knock" | "undercut" }
export function scoreHand(knockerDeadwood, opponentDeadwood) {
  if (knockerDeadwood === 0) {
    return {
      winner: "knocker",
      points: GIN_BONUS + opponentDeadwood,
      result: "gin",
    };
  }
  if (opponentDeadwood <= knockerDeadwood) {
    return {
      winner: "opponent",
      points: UNDERCUT_BONUS + (knockerDeadwood - opponentDeadwood),
      result: "undercut",
    };
  }
  return {
    winner: "knocker",
    points: opponentDeadwood - knockerDeadwood,
    result: "knock",
  };
}
