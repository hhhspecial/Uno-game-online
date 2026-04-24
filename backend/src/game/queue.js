const { handleEvent } = require("./gameEngine")

let queue = []

function addEvent(event){
    queue.push(event)
}

function processQueue() {
  while (queue.length > 0) {
    let e = queue.shift()
    handleEvent(e)
  }
}


module.exports = {addEvent, processQueue}