/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import { mark, measure } from '../util/perf'
import { createEmptyVNode } from '../vdom/vnode'
import { updateComponentListeners } from './events'
import { resolveSlots } from './render-helpers/resolve-slots'
import { toggleObserving } from '../observer/index'
import { pushTarget, popTarget } from '../observer/dep'

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling
} from '../util/index'

// activeInstance 作用就是保持当前上下文的 Vue 实例，它是在 lifecycle 模块的全局变量。
export let activeInstance: any = null
export let isUpdatingChildComponent: boolean = false

// 用 prevActiveInstance 保留上一次的 activeInstance。
// 实际上，prevActiveInstance 和当前的 vm 是一个父子关系
// 当一个 vm 实例完成它的所有子树的 patch 或者 update 过程后，activeInstance 会回到它的父实例
export function setActiveInstance(vm: Component) {
  const prevActiveInstance = activeInstance
  activeInstance = vm
  return () => {
    activeInstance = prevActiveInstance
  }
}

export function initLifecycle (vm: Component) {
  const options = vm.$options

  // locate first non-abstract parent
  let parent = options.parent // 用来保留当前的 vm 的父实例
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent
    }
    // 把当前的 vm 存储到父实例的 $children 中。
    parent.$children.push(vm)
  }

  // vm.$parent 就是用来保留当前 vm 的父实例
  vm.$parent = parent
  vm.$root = parent ? parent.$root : vm

  vm.$children = []
  vm.$refs = {}

  vm._watcher = null
  vm._inactive = null
  vm._directInactive = false
  vm._isMounted = false
  vm._isDestroyed = false
  vm._isBeingDestroyed = false
}

export function lifecycleMixin (Vue: Class<Component>) {
  // _update是实例的一个私有方法，它被调用的时机有两个，一个是首次渲染，一个是数据更新的时候
  // _update 方法的作用是把 VNode 渲染成真实的 DOM
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    // 把当前的 vm 赋值给 activeInstance
    // 这样就完美地保证了 createComponentInstanceForVnode 整个深度遍历过程中，我们在实例化子组件的时候能传入当前子组件的父 Vue 实例，并在 _init 的过程中，通过 vm.$parent 把这个父子关系保留。(⭐)
    const restoreActiveInstance = setActiveInstance(vm)
    // 这个 vnode 是通过 vm._render() 返回的组件渲染 VNode，vm._vnode 和 vm.$vnode 的关系就是一种父子关系，（vm.$vnode定义在./render.js中）
    // vm.$vnode 表示Vue实例的父 VNode
    // 用代码表达就是 vm._vnode.parent === vm.$vnode。
    vm._vnode = vnode 
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    // _update 的核心(⭐)就是调用 vm.__patch__ 方法,这个方法实际上在不同的平台，比如 web 和 weex 上的定义是不一样的，因此在 web 平台中它的定义在 src/platforms/web/runtime/index.js
    if (!prevVnode) {
      // initial render
      // vm.$el 的赋值是在之前 mountComponent 函数做的，vnode 对应的是调用 render 函数的返回值，hydrating 在非服务端渲染情况下为 false，removeOnly 为 false。
      // 回到patch 方法本身，它接收 4个参数，oldVnode 表示旧的 VNode 节点，它也可以不存在或者是一个 DOM 对象；vnode 表示执行 vm._render() 后返回的 VNode 的节点；hydrating 表示是否是服务端渲染；removeOnly 是给 transition-group 用的
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */)
    } else {
      // updates
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    restoreActiveInstance()
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  }

  // 调用渲染 watcher 的 update 方法
  // 让渲染 watcher 对应的回调函数执行，也就是触发了组件的重新渲染。
  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this
    if (vm._watcher) {
      vm._watcher.update()
    }
  }

  // 在 destroy 钩子函数中可以做一些定时器销毁工作
  Vue.prototype.$destroy = function () {
    const vm: Component = this
    if (vm._isBeingDestroyed) {
      return
    }
    callHook(vm, 'beforeDestroy')
    vm._isBeingDestroyed = true
    // remove self from parent
    const parent = vm.$parent
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm)
    }
    // teardown watchers
    if (vm._watcher) {
      vm._watcher.teardown()
    }
    let i = vm._watchers.length
    while (i--) {
      vm._watchers[i].teardown()
    }
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--
    }
    // call the last hook...
    vm._isDestroyed = true
    // invoke destroy hooks on current rendered tree
    // 触发它子组件的销毁钩子函数，这样一层层的递归调用
    // 所以 destroy 钩子函数执行顺序是先子后父，和 mounted 过程一样
    vm.__patch__(vm._vnode, null)
    // fire destroyed hook
    callHook(vm, 'destroyed')
    // turn off all instance listeners.
    vm.$off()
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null
    }
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null
    }
  }
}

// 这个方法的核心就是先实例化渲染一个Watcher, 在它的回调函数中会调用updateComponent方法
// Vue.prototype.$mount 实际上是去调用了mountComponent方法
export function mountComponent (
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  vm.$el = el
  // 经过Vue.prototype.$mount的重新定义，所有的组件渲染最终都会转换成render方法
  if (!vm.$options.render) {
    vm.$options.render = createEmptyVNode
    if (process.env.NODE_ENV !== 'production') {
      /* istanbul ignore if */
      if ((vm.$options.template && vm.$options.template.charAt(0) !== '#') ||
        vm.$options.el || el) {
        warn(
          'You are using the runtime-only build of Vue where the template ' +
          'compiler is not available. Either pre-compile the templates into ' +
          'render functions, or use the compiler-included build.',
          vm
        )
      } else {
        warn(
          'Failed to mount component: template or render function not defined.',
          vm
        )
      }
    }
  }
  // beforeMount 钩子函数发生在 mount，也就是 DOM 挂载之前，它的调用时机是在 mountComponent 函数中
  // 在执行 vm._render() 函数渲染 VNode 之前，执行了 beforeMount 钩子函数
  callHook(vm, 'beforeMount')

  // updateComponent方法中，先生成了虚拟DOM vnode，最终调用了vm._update，更新DOM，完成整个渲染工作
  let updateComponent
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      // _render 中 执行了 _createElement
      const vnode = vm._render() // 核心方法(⭐) 它用来把实例渲染成一个虚拟Node。定义在src/core/instance/render.js
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      // _update 中 patch 执行了 createElm
      vm._update(vnode, hydrating)  // 核心方法(⭐) 把得到的vnode渲染成一个真实的DOM并渲染出来。定义在src/core/instance/lifecycle.js
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      // 在 vm._render() 过程中，会触发所有数据的 getter？？在哪可以看到，这样实际上已经完成了一个依赖收集的过程。
      vm._update(vm._render(), hydrating)
    }
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  // 在组件 mount 的过程中，会实例化一个渲染的 Watcher 去监听 vm 上的数据变化重新渲染
  // Watcher在这里起到两个作用，一个是初始化的时候回执行回调函数，另一个是当vm实例中监测的数据发生变化的时候执行回调函数。
  // noop就是一个空函数
  // 当我们去实例化一个渲染 watcher 的时候，首先进入 watcher 的构造函数逻辑，然后会执行它的 this.get() 方法，进入 get 函数
  new Watcher(vm, updateComponent, noop, {
    before () {
      if (vm._isMounted && !vm._isDestroyed) {
        // beforeUpdate 的执行时机是在渲染 Watcher 的 before 函数中
        callHook(vm, 'beforeUpdate')
        // update 的执行时机是在 flushSchedulerQueue 函数调用的时候，定义在 src/core/observer/scheduler.js
      }
    }
  }, true /* isRenderWatcher */)
  hydrating = false

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  // vm.$vnode表示Vue实例的父虚拟Node，所以它为null表示当前是根Vue的实例
  // 为null则表明这不是一次组件的初始化过程，而是我们通过外部 new Vue 初始化过程。那么对于组件，它的 mounted 时机在哪儿呢？
  // 执行 invokeInsertHook 的 insert。即 componentVNodeHooks 中的 insert 钩子
  if (vm.$vnode == null) { 
    // 设置_isMounted为true，表示这个实例已经挂载了，同时执行mounted钩子函数
    vm._isMounted = true 
    // 在执行完 vm._update() 把 VNode patch 到真实 DOM 后，执行 mounted 钩子
    callHook(vm, 'mounted')
  }
  return vm
}

export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = true
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots
  const oldScopedSlots = vm.$scopedSlots
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key) ||
    (!newScopedSlots && vm.$scopedSlots.$key)
  )

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  const needsForceUpdate = !!(
    renderChildren ||               // has new static slots
    vm.$options._renderChildren ||  // has old static slots
    hasDynamicScopedSlot
  )

  vm.$options._parentVnode = parentVnode
  vm.$vnode = parentVnode // update vm's placeholder node without re-render

  if (vm._vnode) { // update child tree's parent
    vm._vnode.parent = parentVnode
  }
  vm.$options._renderChildren = renderChildren

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject
  vm.$listeners = listeners || emptyObject

  // update props
  if (propsData && vm.$options.props) {
    toggleObserving(false)
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      const propOptions: any = vm.$options.props // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm)
    }
    toggleObserving(true)
    // keep a copy of raw propsData
    vm.$options.propsData = propsData
  }

  // update listeners
  listeners = listeners || emptyObject
  const oldListeners = vm.$options._parentListeners
  vm.$options._parentListeners = listeners
  updateComponentListeners(vm, listeners, oldListeners)

  // resolve slots + force update if has children
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }

  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = false
  }
}

function isInInactiveTree (vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true
  }
  return false
}

export function activateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    callHook(vm, 'activated')
  }
}

export function deactivateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}

// 就是调用某个生命周期钩子注册的所有回调函数。
export function callHook (vm: Component, hook: string) {
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget()
  const handlers = vm.$options[hook]
  const info = `${hook} hook`
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, null, vm, info)
    }
  }
  if (vm._hasHookEvent) {
    vm.$emit('hook:' + hook)
  }
  popTarget()
}
