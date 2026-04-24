const { createDeck, shuffle } = require("./deck")

let games = {}

function createGame(players){
  roomId = "room_"+ Date.now() 

  let deck = shuffle(createDeck())
  let hand ={}

  players.forEach(p => {
    hand[p.id] = deck.splice(0, 7)
  });


  const game = {
    roomId,
    players,
    hand,
    deck,
    currentTurn: players[0].id,
    direction: 1,
    currentCard :{color:"red", value:"5"},
    drawStack : 0,
    status : "playing"
  }

  games[roomId]=game

  return game
}


function getGame(roomID){
  return games[roomID]
}

function updateGame(roomId, newState) {
  games[roomId] = newState;
}

module.exports = {
  createGame,
  getGame,
  updateGame
}