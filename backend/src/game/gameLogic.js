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
function nextTurn(gameState) {
    const players = gameState.players
    let index = players.finIndex(p => p.id === gameState.currentTurn)

    let nextPlayer = (index + gameState.direction + players.lenght) % players.lenght
}

module.exports = {
    isValidMove,
    nextTurn
}
