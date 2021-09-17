/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

/**
 * 主线程的执行过程就是一个 tick，而所有的异步结果都是通过 “任务队列” 来调度。 
 * 消息队列中存放的是一个个的任务（task）。 
 * 规范中规定 task 分为两大类，分别是 macro task 和 micro task，并且每个 macro task 结束后，都要清空所有的 micro task
 */

export let isUsingMicroTask = false

// callbacks 用来存储所有需要执行的回调函数
// callbacks 而不是直接在 nextTick 中执行回调函数的原因是保证在同一个 tick 内多次执行 nextTick，
// 不会开启多个异步任务，而把这些异步任务都压成一个同步任务，在下一个 tick 执行完毕。
const callbacks = []
// pending 用来标志是否正在执行回调函数
let pending = false

// nextTick不顾一切的要把 flushCallbacks 放入微任务或者宏任务中去执行
// 这个函数用来执行callbacks里存储的所有回调函数
function flushCallbacks () {
  pending = false
  // 把callbacks数组复制一份，然后把callbacks置为空
  const copies = callbacks.slice(0)
  callbacks.length = 0
  for (let i = 0; i < copies.length; i++) {
    // 最后把复制出来的数组中的每个函数依次执行一遍
    // 所以 flushCallbacks 的作用仅仅是用来执行callbacks中的回调函数
    copies[i]()
  }
}

// timerFunc 用来触发执行回调函数
let timerFunc
// isNative 这是用来判断所传参数是否在当前环境原生就支持
// 例如某些浏览器不支持Promise，虽然我们使用了垫片(polify)，但是isNative(Promise)还是会返回false。
// 这边代码其实是做了四个判断，对当前环境进行不断的降级处理
// 尝试使用原生的Promise.then、MutationObserver和setImmediate，上述三个都不支持最后使用setTimeout；
// 降级处理的目的都是将flushCallbacks函数放入微任务(判断1和判断2)或者宏任务(判断3和判断4)，等待下一次事件循环时来执行

// 接下来是将触发方式赋值给timerFunc。
// 1.先判断是否原生支持promise，如果支持，则利用promise来触发执行回调函数；
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  const p = Promise.resolve()
  timerFunc = () => {
    p.then(flushCallbacks)
    if (isIOS) setTimeout(noop)
  }
  isUsingMicroTask = true
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // 2.如果支持 MutationObserver ，则实例化一个观察者对象，观察文本节点发生变化时，触发执行所有回调函数
  // MutationObserver是HTML5中的新API，是个用来监视DOM变动的接口。他能监听一个DOM对象上发生的子节点删除、属性修改、文本内容修改等等。
  // 如果改变了就执行 MutationObserver 构造函数中的回调函数，不过是它是在微任务中执行的
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
  timerFunc = () => {
    counter = (counter + 1) % 2
    textNode.data = String(counter)
  }
  isUsingMicroTask = true
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // 3.setImmediate
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {
  // 4.如果都不支持，则利用setTimeout设置延时为0
  // Fallback to setTimeout.
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

// 在数据变化后要执行的某个操作，而这个操作需要使用随数据改变而改变的DOM结构的时候，这个操作都应该放进Vue.nextTick()的回调函数中
// Vue.nextTick用于延迟执行一段代码，它接受2个参数（回调函数和执行回调函数的上下文环境），如果没有提供回调函数，那么将返回promise对象。
export function nextTick (cb?: Function, ctx?: Object) {
  // 在nextTick的外层定义变量就形成了一个闭包
  // 所以我们每次调用$nextTick的过程其实就是在向callbacks新增回调函数的过程。
  let _resolve
  callbacks.push(() => {
    if (cb) {
      try {
        cb.call(ctx)
      } catch (e) {
        handleError(e, ctx, 'nextTick')
      }
    } else if (_resolve) {
      _resolve(ctx)
    }
  })
  // pending 用来标识同一个时间只能执行一次。
  if (!pending) {
    pending = true
    timerFunc()
  }
  // $flow-disable-line
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
