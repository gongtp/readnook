import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
} from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'library',
    component: () => import('@/views/BookshelfView.vue'),
    meta: { title: '书架' },
  },
  {
    path: '/import',
    name: 'import',
    component: () => import('@/views/ImportView.vue'),
    meta: { title: '导入小说' },
  },
  {
    path: '/reader/:bookId',
    name: 'reader',
    component: () => import('@/views/ReaderView.vue'),
    meta: { title: '阅读' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '设置' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0, left: 0 }),
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : 'ReadNook'
  document.title = title === '书架' ? 'ReadNook' : `${title} · ReadNook`
})

export default router
