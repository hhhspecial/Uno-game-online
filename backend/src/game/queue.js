const { handleEvent } = require("./gameEngine")

let queue = []

function addEvent(event){
    queue.push(event)
}

function processQueue() {
    let lastGame = null
    while (queue.length > 0) {
        let e = queue.shift()
        lastGame = handleEvent(e)
    }
    return lastGame
}


module.exports = {addEvent, processQueue}