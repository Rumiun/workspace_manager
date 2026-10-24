/* PM2 配置：pm2 start ecosystem.config.js
   改完环境变量后：pm2 restart seat --update-env
   说明：自有服务器磁盘是持久的，默认用 file 模式（数据存 ./data），
        不需要装 MySQL；想用 MySQL 才把 STORAGE 改成 mysql 并 npm i mysql2。 */
module.exports = {
  apps: [
    {
      name: 'seat',
      script: 'index.js',
      cwd: '/opt/seat-server',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        STORAGE: 'file',
        QR_BASE: 'https://seat.example.edu.cn',
        // 下面四个只有在 STORAGE=mysql 时才需要
        DB_HOST: '',
        DB_PORT: 3306,
        DB_USER: 'root',
        DB_PASSWORD: '',
        DB_NAME: 'seat'
      }
    }
  ]
}
