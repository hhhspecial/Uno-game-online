const { getGame, updateGame } = require("./gameState")
const { isValidMove, nextTurn } = require("./gameLogic")
const { createDeck, shuffle} = require("./deck")

function handleEvent(event) {
  const data = event.data
  const type = event.type
  const { playerId, roomId, card, chosenColor } = data

  const game = getGame(roomId)
  if (!game) return
  if (game.status === "finished") {
        console.log("Game finished")
        return
  }

  // ===== PLAY CARD =====
  if (type === "play_card") {

    // 1. check đúng lượt
    if (game.currentTurn !== playerId) {
      console.log("Not your turn")
      return
    }

    const hand = game.hand[playerId]

    // 2. check có lá này trong tay
    const index = hand.findIndex(
      c => c.color === card.color && c.value === card.value
    )

    if (index === -1) {
      console.log("Card not in hand")
      return
    }

    // 3. check hợp lệ
    if (!isValidMove(card, game.currentCard)) {
      console.log("Invalid move")
      return
    }
    // ❗ rule riêng: draw2 không cho chồng draw4
    if (game.currentCard.value === "draw4" && card.value === "draw2") {
        console.log("Cannot stack draw4 on draw2")
        return
    }

    //4. check stack cong bai
    if (game.drawStack > 0) {
        if (card.value !== "draw2" && card.value !== "draw4") {
            console.log("Must respond to draw stack")
            return
        }
    }
    // 5. check wild trước khi remove
    if (card.color === "wild") {

        if (!chosenColor) {
            console.log("Must choose color")
            return
        }

        const validColors = ["red", "blue", "green", "yellow"]

        if (!validColors.includes(chosenColor)) {
            console.log("Invalid color")
            return
        }
    }


    // 4. update
    
    hand.splice(index, 1)
    if (hand.length === 0) {
        game.status = "finished"
        console.log(playerId + " wins!")
        return
    }

    // 7. update current card
    if (card.color === "wild") {
        game.currentCard = {
         color: chosenColor,
         value: card.value
         }
    } else {
        game.currentCard = card
    }

    if (card.value === "skip") {
        nextTurn(game)
    }

    if (card.value === "reverse") {
        game.direction *= -1
    }
    if (card.value === "draw2") {
        game.drawStack += 2
    }
    if (card.value === "draw4") {
        game.drawStack += 4
    }


    nextTurn(game)
  }

  // ===== DRAW CARD =====
    if (type === "draw_card") {

        if (game.currentTurn !== playerId) {
            console.log("Not your turn")
            return
        }

        console.log("DRAW:", playerId, "STACK:", game.drawStack)

        // ===== HANDLE STACK =====
        if (game.drawStack > 0) {

            for (let i = 0; i < game.drawStack; i++) {

                if (game.deck.length === 0) {
                    game.deck = shuffle(createDeck())
                }

                const card = game.deck.pop()

                if (card) {
                    game.hand[playerId].push(card)
                }
            }

            game.drawStack = 0
            nextTurn(game)
            updateGame(roomId, game)
            return
        }

        // ===== NORMAL DRAW =====
        if (game.deck.length === 0) {
            game.deck = shuffle(createDeck())
        }

        const drawn = game.deck.pop()

        if (drawn) {
            game.hand[playerId].push(drawn)
        }

        nextTurn(game)
    }

  updateGame(roomId, game)

  return game
}

module.exports = {
  handleEvent
}