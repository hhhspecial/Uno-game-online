function isValidMove(card,currentCard){
    if(card.color === currentCard.color ||
        card.value === currentCard.value ||
        card.color === "wild"
    ){
      return true 
    }else{
        return false
    }
}
function nextTurn(game) {
  const players = game.players

  const index = players.findIndex(p => p.id === game.currentTurn)

  if (index === -1) {
    console.log("ERROR: currentTurn not found")
    return
  }

  const nextIndex =
    (index + game.direction + players.length) % players.length

  game.currentTurn = players[nextIndex].id
}

module.exports = {
    isValidMove,
    nextTurn
}
