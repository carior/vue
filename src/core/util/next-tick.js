/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = []
let pending = false

// nextTick不顾一切的要把 flushCallbacks 放入微任务或者宏任务中去执行
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

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
// isNative 这是用来判断所传参数是否在当前环境原生就支持
// 例如某些浏览器不支持Promise，虽然我们使用了垫片(polify)，但是isNative(Promise)还是会返回false。
// 这边代码其实是做了四个判断，对当前环境进行不断的降级处理
// 尝试使用原生的Promise.then、MutationObserver和setImmediate，上述三个都不支持最后使用setTimeout；
// 降级处理的目的都是将flushCallbacks函数放入微任务(判断1和判断2)或者宏任务(判断3和判断4)，等待下一次事件循环时来执行
// MutationObserver 是Html5的一个新特性，用来监听目标DOM结构是否改变，也就是代码中新建的textNode
// 如果改变了就执行 MutationObserver 构造函数中的回调函数，不过是它是在微任务中执行的
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  const p = Promise.resolve()
  timerFunc = () => {
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    if (isIOS) setTimeout(noop)
  }
  isUsingMicroTask = true
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
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
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {
  // Fallback to setTimeout.
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

// - 把回调函数放入callbacks等待执行
// - 将执行函数放到微任务或者宏任务中
// - 事件循环到了微任务或者宏任务，执行函数依次执行callbacks中的回调
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
