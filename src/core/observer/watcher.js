/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      // 接着把当前 watcher 的实例赋值给 vm._watcher
      vm._watcher = this
    }
    // 把当前 wathcer 实例 push 到 vm._watchers 中
    // vm._watcher 是专门用来监听 vm 上数据变化然后重新渲染的，所以它是一个渲染相关的 watcher
    // 因此在 callUpdatedHooks 函数中，只有 vm._watcher 的回调执行完毕后，才会执行 updated 钩子函数。
    vm._watchers.push(this)
    // Watcher 的构造函数对 options 做的了处理
    // watcher 总共有 4 种类型
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user // 通过 vm.$watch 创建的 watcher 是一个 user watcher
      this.lazy = !!options.lazy // lazy watcher 几乎就是为计算属性 computed 量身定制的
      // 当响应式数据发送变化后，触发了 watcher.update()，只是把这个 watcher 推送到一个队列中，在 nextTick 后才会真正执行 watcher 的回调函数。
      // 而一旦我们设置了 sync，就可以在当前 Tick 中同步执行 watcher 的回调函数
      // 只有当我们需要 watch 的值的变化到执行 watcher 的回调函数是一个同步过程的时候才会去设置该属性为 true。
      // 但在官网文档中甚至没有告诉用户options参数包含sync配置项。因此在我理解中，用户是无法创建同步更新的watcher的。
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    // 定义了一些和 Dep 相关的属性
    // this.deps 和 this.newDeps 表示 Watcher 实例持有的 Dep 实例的数组
    this.deps = []
    this.newDeps = []
    // this.depIds 和 this.newDepIds 分别代表 this.deps 和 this.newDeps 的 id Set
    // （这个 Set 是 ES6 的数据结构，它的实现在 src/core/util/env.js 中）
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // new Watcher() 执行它的 this.get() 方法，进入 get 函数
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  get () {
    // pushTarget 的定义在 src/core/observer/dep.js 中
    // 此时就和 Dep 发布者产生了联系，Dep 的 target 被设置为了这个 wacher，并且在每次监测对象被 get 时，就会往自身的 Dep 里推入这个 wacher
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      // this.getter 对应就是 updateComponent 函数
      // 这实际上就是在执行：vm._update(vm._render(), hydrating)
      // 它会先执行 vm._render() 方法，因为之前分析过这个方法会生成 渲染 VNode，
      // 并且在这个过程中会对 vm 上的数据访问，这个时候就触发了数据对象的 getter
      // 触发getter后 通过 dep.depend 做依赖收集
      // 然后执行了 Dep.target.addDep(this) ，当前的 Dep.target 已经被赋值为渲染 watcher 了，相当于执行 watcher 的 addDep
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        // handleError 在 Vue 中是一个错误捕获并且暴露给用户的一个利器
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      // 在完成依赖收集后，是要递归去访问 value，触发它所有子项的 getter
      if (this.deep) {
        // 它的定义在 src/core/observer/traverse.js 中
        // 那么在执行了 traverse 后，我们再对 watch 的对象内部任何一个值做修改，也会调用 watcher 的回调函数了。
        traverse(value)
      }
      // 把 Dep.target 恢复成上一个状态，
      // 因为当前 vm 的数据依赖收集已经完成，那么对应的渲染Dep.target 也需要改变。
      // popTarget 的定义在 src/core/observer/dep.js 中
      popTarget()
      // 最后进行依赖清空
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   * 添加一个依赖项
   */
  addDep (dep: Dep) {
    const id = dep.id
    // 保证同一数据不会被添加多次
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        // addSub 执行 dep 的 this.subs.push(sub)
        // 也就是把当前的 watcher 订阅到这个数据持有的 dep 的 subs 中
        // 这个目的是为后续数据变化时候能通知到哪些 subs 做准备。
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   * 依赖清空
   * 考虑到 Vue 是数据驱动的，所以每次数据变化都会重新 render，
   * 那么 vm._render() 方法又会再次执行，并再次触发数据的 getters，
   * 所以 Watcher 在构造函数中会初始化 2 个 Dep 实例数组，
   * newDeps 表示新添加的 Dep 实例数组，而 deps 表示上一次添加的 Dep 实例数组。
   *
   * Vue 设计了在每次添加完新的订阅，会移除掉旧的订阅，
   * 这样就保证了在我们刚才的场景中，如果渲染 b 模板的时候去修改 a 模板的数据，a 数据订阅回调已经被移除了，
   * 所以不会有任何浪费，真的是非常赞叹 Vue 对一些细节上的处理。
   */
  cleanupDeps () {
    let i = this.deps.length
    // 首先遍历 deps，移除对 dep.subs 数组中 Wathcer 的订阅
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    // 然后把 newDepIds 和 depIds 交换
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    // 把 newDepIds 清空
    this.newDepIds.clear()
    // newDeps 和 deps 交换
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    // 把 newDeps 清空
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   * update接收到dep发出的广播之后调用 queueWatcher
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      // 把 this.dirty = true，只有当下次再访问这个计算属性的时候才会重新求值
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      // queueWatcher 的定义在 src/core/observer/scheduler.js
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      // 对于渲染 watcher 而言，它在执行 this.get() 方法求值的时候，会执行 getter 方法
      const value = this.get()
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          // 这就是当我们添加自定义 watcher 的时候能在回调函数的参数中拿到新旧值的原因。
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    // 在求值过程中，会执行 value = this.getter.call(vm, vm)，这实际上就是执行了计算属性定义的 getter 函数
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   * 移除这个 watcher
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
