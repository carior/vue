/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

export function initAssetRegisters (Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  ASSET_TYPES.forEach(type => {
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) {
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        // Vue.component 函数的定义
        if (type === 'component' && isPlainObject(definition)) {
          definition.name = definition.name || id
          // his.options._base.extend 相当于 Vue.extend 把这个对象转换成一个继承于 Vue 的构造函数
          definition = this.options._base.extend(definition)
        }
        if (type === 'directive' && typeof definition === 'function') {
          definition = { bind: definition, update: definition }
        }
        // 当type为component时，把它挂载到 Vue.options.components 上
        this.options[type + 's'][id] = definition
        return definition
      }
    }
  })
}
