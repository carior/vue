/* @flow */

import {
  warn,
  once,
  isDef,
  isUndef,
  isTrue,
  isObject,
  hasSymbol,
  isPromise,
  remove
} from 'core/util/index'

import { createEmptyVNode } from 'core/vdom/vnode'
import { currentRenderingInstance } from 'core/instance/render'

// 这个函数目的是为了保证能找到异步组件 JS 定义的组件对象，
// 并且如果它是一个普通对象，则调用 Vue.extend 把它转换成一个组件的构造函数。
function ensureCtor (comp: any, base) {
  if (
    comp.__esModule ||
    (hasSymbol && comp[Symbol.toStringTag] === 'Module')
  ) {
    comp = comp.default
  }
  return isObject(comp)
    ? base.extend(comp)
    : comp
}

// 是创建了一个占位的注释 VNode，同时把 asyncFactory 和 asyncMeta 赋值给当前 vnode
export function createAsyncPlaceholder (
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode {
  const node = createEmptyVNode()
  node.asyncFactory = factory
  node.asyncMeta = { data, context, children, tag }
  return node
}

// 逻辑略复杂
// 高级异步组件的实现是非常巧妙的，它实现了 loading、resolve、reject、timeout 4 种状态
// 异步组件实现的本质是 2 次渲染
// 除了 0 delay 的高级异步组件第一次直接渲染成 loading 组件外，其它都是第一次渲染生成一个注释节点
// 当异步获取组件成功后，再通过 forceRender 强制重新渲染，这样就能正确渲染出我们异步加载的组件了。
// 实际上处理了 3 种异步组件的创建方式
export function resolveAsyncComponent (
  factory: Function,
  baseCtor: Class<Component>
): Class<Component> | void {
  // 返回 factory.errorComp，直接渲染 error 组件
  if (isTrue(factory.error) && isDef(factory.errorComp)) {
    return factory.errorComp
  }

  if (isDef(factory.resolved)) {
    return factory.resolved
  }

  const owner = currentRenderingInstance
  if (owner && isDef(factory.owners) && factory.owners.indexOf(owner) === -1) {
    // already pending
    factory.owners.push(owner)
  }

  // 如果异步组件加载中并未返回，这时候会走到这个逻辑
  if (isTrue(factory.loading) && isDef(factory.loadingComp)) {
    // 会返回 factory.loadingComp，渲染 loading 组件
    return factory.loadingComp
  }

  // 对于 factory.owners 的判断，是考虑到多个地方同时初始化一个异步组件，那么它的实际加载应该只有一次
  if (owner && !isDef(factory.owners)) {
    // 实际加载逻辑
    const owners = factory.owners = [owner]
    let sync = true
    let timerLoading = null
    let timerTimeout = null

    ;(owner: any).$on('hook:destroyed', () => remove(owners, owner))

    // 当执行 forceRender 的时候，会触发组件的重新渲染，
    // 那么会再一次执行 resolveAsyncComponent 这时候就会根据不同的情况，可能返回 loading、error 或成功加载的异步组件
    // 返回值不为 undefined，因此就走正常的组件 render、patch 过程，
    // 与组件第一次渲染流程不一样，这个时候是存在新旧 vnode 的，下一章我会分析组件更新的 patch 过程。
    const forceRender = (renderCompleted: boolean) => {
      // 遍历 owners ，拿到每一个调用异步组件的实例 vm, 执行 vm.$forceUpdate() 方法，它的定义在 src/core/instance/lifecycle.js 中
      // 之所以这么做是因为 Vue 通常是数据驱动视图重新渲染，
      // 但是在整个异步组件加载过程中是没有数据发生变化的，所以通过执行 $forceUpdate 可以强制组件重新渲染一次。
      for (let i = 0, l = owners.length; i < l; i++) {
        (owners[i]: any).$forceUpdate()
      }

      if (renderCompleted) {
        owners.length = 0
        if (timerLoading !== null) {
          clearTimeout(timerLoading)
          timerLoading = null
        }
        if (timerTimeout !== null) {
          clearTimeout(timerTimeout)
          timerTimeout = null
        }
      }
    }

    // 注意 resolve 和 reject 函数用 once 函数做了一层包装，它的定义在 src/shared/util.js 中
    // 当组件异步加载成功后，执行 resolve，首先把加载结果缓存到 factory.resolved 中，这个时候因为 sync 已经为 false，
    // 则执行 forceRender() 再次执行到 resolveAsyncComponent：
    const resolve = once((res: Object | Class<Component>) => {
      // cache resolved
      factory.resolved = ensureCtor(res, baseCtor)
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)
      if (!sync) {
        forceRender(true)
      } else {
        owners.length = 0
      }
    })

    // 加载失败则执行 reject
    // 如果超时，则走到了 reject 逻辑，之后逻辑和加载失败一样，渲染 error 组件
    const reject = once(reason => {
      process.env.NODE_ENV !== 'production' && warn(
        `Failed to resolve async component: ${String(factory)}` +
        (reason ? `\nReason: ${reason}` : '')
      )
      if (isDef(factory.errorComp)) {
        factory.error = true
        forceRender(true)
      }
    })

    // 这块儿就是执行我们组件的工厂函数
    // 组件的工厂函数通常会先发送请求去加载我们的异步组件的 JS 文件，拿到组件定义的对象 res 后
    // 执行 resolve(res) 逻辑
    const res = factory(resolve, reject)

    if (isObject(res)) {
      if (isPromise(res)) {
        // 如果是Promise创建的组件 则执行这里
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject)
        }
      } else if (isPromise(res.component)) {
        // res 就是定义的组件对象
        res.component.then(resolve, reject)

        if (isDef(res.error)) {
          factory.errorComp = ensureCtor(res.error, baseCtor)
        }

        if (isDef(res.loading)) {
          factory.loadingComp = ensureCtor(res.loading, baseCtor)
          if (res.delay === 0) {
            factory.loading = true
          } else {
            timerLoading = setTimeout(() => {
              timerLoading = null
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                factory.loading = true
                // 如果 delay 配置为 0，则这次直接渲染 loading 组件，否则则延时 delay 执行 forceRende
                forceRender(false)
              }
            }, res.delay || 200)
          }
        }

        if (isDef(res.timeout)) {
          timerTimeout = setTimeout(() => {
            timerTimeout = null
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== 'production'
                  ? `timeout (${res.timeout}ms)`
                  : null
              )
            }
          }, res.timeout)
        }
      }
    }

    sync = false
    // return in case resolved synchronously
    return factory.loading
      ? factory.loadingComp
      : factory.resolved
  }
}
