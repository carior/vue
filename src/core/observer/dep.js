/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
// 是整个 getter 依赖收集的核心，Dep实际上就是对 Watcher 的一种管理
// Watcher 定义在 src/core/observer/watcher.js 中
export default class Dep {
  // 这里需要特别注意的是它有一个静态属性 target
  // 这是一个全局唯一 Watcher
  // 这是一个非常巧妙的设计(⭐)，因为在同一时间只能有一个全局的 Watcher 被计算
  static target: ?Watcher;
  id: number;
  // 另外它的自身属性 subs 也是 Watcher 的数组
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = []
  }

  addSub (sub: Watcher) {
    // 把当前的 watcher 订阅到这个数据持有的 dep 的 subs 中
    // 这个目的是为后续数据变化时候能通知到哪些 subs 做准备
    this.subs.push(sub)
  }

  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  depend () {
    // 如果 Dep.target 已经被赋值为渲染 watcher，那么就执行到 addDep 方法
    if (Dep.target) {
      Dep.target.addDep(this)
    }
  }

  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    // 遍历所有的subs，也就是Watcher数组
    // 然后调用每一个 watcher 的 update 方法
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.
Dep.target = null
const targetStack = []

// 实际上就是把 Dep.target 赋值为当前的渲染 watcher 并压栈（为了恢复用）
export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}

export function popTarget () {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
