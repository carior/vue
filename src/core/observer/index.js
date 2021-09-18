/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 * Observer 是一个类，它的作用是给对象的属性添加 getter 和 setter，用于依赖收集和派发更新
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data
  constructor (value: any) {
    this.value = value
    // 首先实例化 Dep 对象
    // Dep 是什么 是干嘛的？  Dep 实际上就是对 Watcher 的一种管理
    this.dep = new Dep()
    this.vmCount = 0
    // 通过执行 def 函数把自身实例添加到数据对象 value 的 __ob__ 属性上
    // def 的定义在 src/core/util/lang.js，是对 Object.defineProperty 的封装
    // 这就是为什么我在开发中输出 data 上对象类型的数据，会发现该对象多了一个 __ob__ 的属性
    def(value, '__ob__', this)
    // 只需要关注 value 是 Array 的情况
    if (Array.isArray(value)) {
      // hasProto 实际上就是判断对象中是否存在 __proto__
      if (hasProto) {
        // 如果存在则 augment 指向 protoAugment
        protoAugment(value, arrayMethods)
      } else {
        // 否则指向 copyAugment
        copyAugment(value, arrayMethods, arrayKeys)
      }
      // 对于数组会调用 observeArray 方法
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   * 纯对象调用 walk 方法
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      // 真正给对象的属性 动态添加 getter 和 setter 在 defineReactive 里
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items
   * observeArray 是遍历数组再次调用 observe 方法.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
// 对于大部分现代浏览器都会走到 protoAugment
// 它实际上就把 value 的原型指向了 arrayMethods
// arrayMethods 的定义在 src/core/observer/array.js 中
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  // 把 target.__proto__ 原型直接修改为 src
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
// 方法是遍历 keys，通过 def，也就是 Object.defineProperty 去定义它自身的属性值
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 * observe 的功能就是用来监测数据的变化
 * 方法的作用就是给非 VNode 的对象类型数据添加一个 Observer
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // value 不是对象 或者 value 是一个 VNode
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    // 如果已经添加过则直接返回
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    // 去实例化一个 Observer 对象实例
    // Observer 是一个类，它的作用是给对象的属性添加 getter 和 setter，用于依赖收集和派发更新：
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 * 定义一个响应式对象，给对象动态添加 getter 和 setter
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // 函数最开始初始化 Dep 对象的实例
  // Dep 是整个 getter 依赖收集的核心(⭐)，定义在 src/core/observer/dep.js 中
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  // 当且仅当该属性的 configurable 键值为 true 时，该属性的描述符才能够被改变，同时该属性也能从对应的对象上被删除。
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  // 接着拿到 obj 的属性描述符，然后对子对象递归调用 observe 方法
  // 这样就保证了无论 obj 的结构多复杂，它的所有子属性也能变成响应式的对象
  // 这样我们访问或修改 obj 中一个嵌套较深的属性，也能触发 getter 和 setter
  // 最后利用 Object.defineProperty 去给 obj 的属性 key 添加 getter 和 setter。
  // 目的就是为了在我们访问数据以及写数据的时候能自动执行一些逻辑
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // getter 做的事情是依赖收集
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        // 触发getter后 通过 dep.depend 做依赖收集
        // 也就会执行 Dep.target.addDep(this)。(⭐) this 是 传入的 watcher
        // 也就会执行到 dep.addSub(this) this 是传入的watcher
        // 也就是 this.subs.push(sub) 这里的 this 是 Dep， sub是传入的watcher
        // 最终其实是把 watcher 传入到 subs 里面去，也就是对应的 Dep 对象中去
        dep.depend()
        if (childOb) {
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    // setter 做的事情是派发更新
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 如果两次的值相等 什么也不做
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      // 如果 shallow 为 false 的情况，会对新设置的值变成一个响应式对象
      // 如果发现新值又是一个对象，那么将其变成响应式的
      childOb = !shallow && observe(newVal)
      // 通知所有的订阅者
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 * Vue 也是不能检测到以下变动的数组：
 * 1.当你利用索引直接设置一个项时，例如：vm.items[indexOfItem] = newValue
 * 2.当你修改数组的长度时，例如：vm.items.length = newLength
 * 对于第一种情况，可以使用：Vue.set(example1.items, indexOfItem, newValue)；
 * 而对于第二种情况，可以使用 vm.items.splice(newLength)。
 * 那么这里的 splice 到底有什么黑魔法，能让添加的对象变成响应式的呢
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  // 如果 target 是数组且 key 是一个合法的下标，则之前通过 splice 去添加进数组然后返回，
  // 这里的 splice 其实已经不仅仅是原生数组的 splice 了
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  // 又判断 key 已经存在于 target 中，则直接赋值返回
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  // 接着再获取到 target.__ob__ 并赋值给 ob
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  // 之前分析过它是在 Observer 的构造函数执行的时候初始化的，表示 Observer 的一个实例，
  // 如果它不存在，则说明 target 不是一个响应式的对象，则直接赋值并返回
  if (!ob) {
    target[key] = val
    return val
  }
  // 把新添加的属性变成响应式对象
  defineReactive(ob.value, key, val)
  // 手动的触发依赖通知
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
