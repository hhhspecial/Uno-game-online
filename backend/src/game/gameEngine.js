const { getGame, updateGame, deleteGame } = require("./gameState")
const { isValidMove, nextTurn } = require("./gameLogic")
const { createDeck, shuffle} = require("./deck")
const { setStatus } = require("../lobby/roomManager")

const User = require("../auth/userModel")
const GameHistory = require("./gameHistoryModel")
const { saveMatchResultAndRewards } = require("../lobby/roomManager")

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

    // 1. check correct turn
    if (game.currentTurn !== playerId) {
      console.log("Not your turn")
      return
    }

    const hand = game.hand[playerId]

    if (game.drawnThisTurn) {
        const drawnCard = game.drawnThisTurn
        if (card.color !== drawnCard.color || card.value !== drawnCard.value) {
            console.log("After drawing, can only play the drawn card")
            return
        }
    }

    const index = hand.findIndex(
      c => c.color === card.color && c.value === card.value
    )

    if (index === -1) {
      console.log("Card not in hand")
      return
    }

    if (!isValidMove(card, game.currentCard)) {
      console.log("Invalid move")
      return
    }
    // ❗ special rule: cannot stack draw2 on draw4
    if (game.currentCard.value === "draw4" && card.value === "draw2" && game.drawStack > 0) {
        console.log("Cannot stack draw4 on draw2")
        return
    }

    if (game.drawStack > 0) {
        if (card.value !== "draw2" && card.value !== "draw4") {
            console.log("Must respond to draw stack")
            return
        }
    }
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


    // update — clear drawn state
    game.drawnThisTurn = null
    
    hand.splice(index, 1)
    if (hand.length === 0) {
        game.status = "finished"
        game.winnerId = playerId
        console.log(playerId + " wins!")
        updateGame(roomId, game)
        setStatus(roomId, "waiting") 
        
        saveMatchResultAndRewards(roomId, game.players, playerId)
            .then(() => console.log(`Database updated successfully for finished game in Room ${roomId}`))
            .catch(err => console.error("Error updating database", err));

        // delay game deletion to allow clients to receive final state
        setTimeout(() => {
            deleteGame(roomId)
        }, 8000) 
        return game
    }

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

        // Prevent drawing again if already drew this turn
        if (game.drawnThisTurn) {
            console.log("Already drew this turn — must play or keep")
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
            return game
        }

        // ===== NORMAL DRAW =====
        if (game.deck.length === 0) {
            game.deck = shuffle(createDeck())
        }

        const drawn = game.deck.pop()

        if (drawn) {
            game.hand[playerId].push(drawn)

            // if the drawn card is playable, let the player choose to play it or keep it
            if (isValidMove(drawn, game.currentCard)) {
                console.log("Drawn card is playable, waiting for player choice:", drawn)
                game.drawnThisTurn = drawn
                // don't call nextTurn — player must choose play or keep
            } else {
                console.log("Drawn card not playable, passing turn:", drawn)
                nextTurn(game)
            }
        } else {
            nextTurn(game)
        }
    }

  // keep card
    if (type === "keep_card") {
        if (game.currentTurn !== playerId) {
            console.log("Not your turn")
            return
        }

        if (!game.drawnThisTurn) {
            console.log("No drawn card to keep")
            return
        }

        console.log("Player chose to keep drawn card:", game.drawnThisTurn)
        game.drawnThisTurn = null
        nextTurn(game)
    }

  updateGame(roomId, game)

  return game
}

module.exports = {
  handleEvent
}