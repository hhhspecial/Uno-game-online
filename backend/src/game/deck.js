function createDeck() {
  const colors = ["red", "blue", "green", "yellow"]
  const numbers = ["1","2","3","4","5","6","7","8","9"]
  const specials = ["skip", "reverse", "draw2"]

  let deck = []

  // 🟥 COLOR CARDS
  colors.forEach(color => {
    // 1 lá số 0
    deck.push({ color, value: "0" })

    // 2 lá mỗi số 1-9
    numbers.forEach(num => {
      deck.push({ color, value: num })
      deck.push({ color, value: num })
    })

    // 2 lá mỗi special
    specials.forEach(sp => {
      deck.push({ color, value: sp })
      deck.push({ color, value: sp })
    })
  })

  // 🃏 WILD
  for (let i = 0; i < 4; i++) {
    deck.push({ color: "wild", value: "wild" })
    deck.push({ color: "wild", value: "draw4" })
  }

  return deck
}

function shuffle(deck) {
  return deck.sort(() => Math.random() - 0.5)
}

module.exports = {
  createDeck,
  shuffle
}