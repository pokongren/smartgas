/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            // 可以在这里扩展主题配置
            colors: {
                // 自定义颜色
            },
            spacing: {
                // 自定义间距
            },
        },
    },
    plugins: [],
}
