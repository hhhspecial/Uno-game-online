const { handleEvent } = require("./gameEngine")

let queue = []

function addEvent(event){
    queue.push(event)
}


function processQueue() {
    let lastGame = null
    while (queue.length > 0) {
        let e = queue.shift()
        lastGame = handleEvent(e)  // ← handleEvent đã return game
    }
    return lastGame  // ← trả về game cuối cùng
}


module.exports = {addEvent, processQueue}