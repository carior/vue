/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'

let uid = 0

export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // 一个避免被发现的标志
    vm._isVue = true
    // merge options 合并配置
    // 子组件初始化过程通过 initInternalComponent 方式要比外部初始化 Vue 通过 mergeOptions 的过程要快，合并完的结果保留在 vm.$options 中
    // 纵观一些库、框架的设计几乎都是类似的，自身定义了一些默认配置，同时又可以在初始化阶段传入一些定义配置，然后去 merge 默认配置，来达到定制化不同需求的目的。
    if (options && options._isComponent) {
      // 优化内部组件实例化 因为动态选项合并非常慢，而且没有内部组件选项需要特殊处理
      initInternalComponent(vm, options)
    } else {
      // 这样就把 Vue 上的一些 option 扩展到了 vm.$options 上
      // mergeOptions的功能是把 Vue 构造函数的 options 和用户传入的 options 做一层合并，到 vm.$options 上。
      // Vue.options 的 定义在 src/core/global-api/index.js 中
      // mergeOptions 方法定义在 src/core/util/options.js 中
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    initLifecycle(vm) // 初始化生命周期
    initEvents(vm) // 初始化事件中心
    initRender(vm) // 初始化渲染
    callHook(vm, 'beforeCreate')
    initInjections(vm) // resolve injections before data/props
    initState(vm) // 初始化 data、props、computed、watcher
    initProvide(vm) // resolve provide after data/props
    callHook(vm, 'created')

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }
    // 组件初始化的时候是不传el的 组件是自己接管了 $mount 的过程，在组件的 componentVNodeHooks 函数中 init 过程执行的
    if (vm.$options.el) {
      // vm.$mount 方法挂载 vm，挂载的目标就是把模板渲染成最终的DOM
      // $mount方法在多个文件中都有定义，
      // 如 src/platform/web/entry-runtime-with-compiler.js、src/platform/web/runtime/index.js、src/platform/weex/runtime/index.js。
      // 因为 $mount 这个方法的实现是和平台、构建方式都相关的。
      // 我们主要看带 compiler 版本的 $mount 实现
      vm.$mount(vm.$options.el)
    }
  }
}

// initInternalComponent 合并 options，做了简单一层对象赋值
export function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  // 这里的 vm.constructor 就是子组件的构造函数 Sub，相当于 vm.$options = Object.create(Sub.options)。
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  const parentVnode = options._parentVnode
  // 下面是把之前我们通过 createComponentInstanceForVnode（定义在src\core\vdom\create-component.js） 函数传入的几个参数合并到内部的选项 $options 里了
  opts.parent = options.parent // (⭐) 把 parent 存储在 vm.$options 中，在 $mount 之前会调用 initLifecycle(vm) 方法，初始化生命周期，parent 是父Vue实例
  opts._parentVnode = parentVnode // (⭐) _parentVnode 就是当前组件的父 VNode 实例

  const vnodeComponentOptions = parentVnode.componentOptions
  opts.propsData = vnodeComponentOptions.propsData
  opts._parentListeners = vnodeComponentOptions.listeners
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

export function resolveConstructorOptions (Ctor: Class<Component>) {
  let options = Ctor.options
  if (Ctor.super) {
    const superOptions = resolveConstructorOptions(Ctor.super)
    const cachedSuperOptions = Ctor.superOptions
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions)
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions (Ctor: Class<Component>): ?Object {
  let modified
  const latest = Ctor.options
  const sealed = Ctor.sealedOptions
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      modified[key] = latest[key]
    }
  }
  return modified
}
