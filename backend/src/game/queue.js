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

function handleEvent(event){
    if(event.type = "play_card"){
        //check hop le
        //udate state
    }
    if(event.type = "draw_card"){
        // thêm bài
    }
}

module.exports = {addEvent, processQueue}