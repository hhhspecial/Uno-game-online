let games = {}

function createGame(players){
  roomId = "room_"+ Date.now() 

  let hand ={}

  players.forEach(p => {
    hand[p.id] = []
  });


  const game = {
    roomId,
    players,
    hand,
    currentTurn: players[0].id,
    direction: 1,
    currentCard :{color:"Red", value:"5"},
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