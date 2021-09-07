/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)

// patch方法的定义是调用 createPatchFunction 方法的返回值
// nodeOps 封装了一系列 DOM 操作的方法，modules 定义了一些模块的钩子函数的实现
/**
 * 为何 Vue.js 源码绕了这么一大圈，把相关代码分散到各个目录。
 * 因为前面介绍过，patch 是平台相关的，在 Web 和 Weex 环境，它们把虚拟 DOM 映射到 “平台 DOM” 的方法是不同的，并且对 “DOM” 包括的属性模块创建和更新也不尽相同。
 * 因此每个平台都有各自的 nodeOps 和 modules，它们的代码需要托管在 src/platforms 这个大目录下。
 * 而不同平台的 patch 的主要逻辑部分是相同的，所以这部分公共的部分托管在 core 这个大目录下。
 * 差异化部分只需要通过参数来区别。
 * 这里用到了一个函数柯里化的技巧，通过 createPatchFunction 把差异化参数提前固化，这样不用每次调用 patch 的时候都传递 nodeOps 和 modules 了，这种编程技巧也非常值得学习。
 * */ 
export const patch: Function = createPatchFunction({ nodeOps, modules })

// 函数柯里化
// 概念：
// 1.柯里化：就是一个函数，原本有多个参数，现在只传入一个参数 生成一个新函数，由函数来接收剩下的参数，运行得到结果
// 2.偏函数：就是一个函数，原本有多个参数，现在只传入一部分参数 生成一个新函数，由函数来接收剩下的参数，运行得到结果
// 3.高阶函数：一个函数参数是一个函数，该函数对参数这个函数加工，得到一个函数，这个加工用的函数就是高阶函数
// 为什么要使用柯里化？把函数一部分消耗性能的地方缓存起来，返回一个新的函数，可以提升函数的性能