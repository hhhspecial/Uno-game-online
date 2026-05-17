const { handleEvent } = require("./gameEngine")

let queue = []

function addEvent(event){
    queue.push(event)
}

function processQueue() {
  let result = null
  while (queue.length > 0) {
    let e = queue.shift()
    result = handleEvent(e)
  }
  return result
}


module.exports = {addEvent, processQueue}