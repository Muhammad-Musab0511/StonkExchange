const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/portfolio', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM v_user_portfolio WHERE user_id = $1 ORDER BY ticker',
    [req.user.userId]
  );
  res.json({ data: rows });
});

router.get('/wallet', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT wallet_id, cash_balance, reserved_balance, updated_at FROM wallets WHERE user_id = $1',
    [req.user.userId]
  );
  res.json({ data: rows[0] || null });
});

router.post('/deposit', async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Amount must be positive' });
  }

  try {
    await pool.query('SELECT deposit_funds($1, $2)', [req.user.userId, amount]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
});

router.post('/withdraw', async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Amount must be positive' });
  }

  try {
    await pool.query('SELECT withdraw_funds($1, $2)', [req.user.userId, amount]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
});

router.get('/pnl', async (req, res) => {
  try {
    const { rows: portfolio } = await pool.query(
      'SELECT * FROM v_user_portfolio WHERE user_id = $1 AND quantity > 0 ORDER BY ticker',
      [req.user.userId]
    );

    const pnl = {
      daily: 0,
      weekly: 0,
      monthly: 0,
      holdings: []
    };

    for (const holding of portfolio) {
      // Get current value
      const currentValue = Number(holding.quantity || 0) * Number(holding.last_price || 0);
      
      // Get prices from 1d, 7d, 30d ago
      const { rows: prices } = await pool.query(
        `
        SELECT
          (SELECT close_price FROM price_history 
           WHERE stock_id = $1 
           AND recorded_at < NOW() - INTERVAL '1 day'
           ORDER BY recorded_at DESC LIMIT 1) AS price_1d,
          (SELECT close_price FROM price_history 
           WHERE stock_id = $1 
           AND recorded_at < NOW() - INTERVAL '7 days'
           ORDER BY recorded_at DESC LIMIT 1) AS price_7d,
          (SELECT close_price FROM price_history 
           WHERE stock_id = $1 
           AND recorded_at < NOW() - INTERVAL '30 days'
           ORDER BY recorded_at DESC LIMIT 1) AS price_30d
        `,
        [holding.stock_id]
      );

      const p = prices[0] || {};
      const qty = Number(holding.quantity || 0);
      const currentPrice = Number(holding.last_price || 0);

      // Only calculate P&L if historical data exists
      const pnl1d = p.price_1d ? (currentPrice - Number(p.price_1d)) * qty : 0;
      const pnl7d = p.price_7d ? (currentPrice - Number(p.price_7d)) * qty : 0;
      const pnl30d = p.price_30d ? (currentPrice - Number(p.price_30d)) * qty : 0;

      pnl.daily += pnl1d;
      pnl.weekly += pnl7d;
      pnl.monthly += pnl30d;

      pnl.holdings.push({
        ticker: holding.ticker,
        quantity: qty,
        currentPrice,
        currentValue,
        pnl1d,
        pnl7d,
        pnl30d
      });
    }

    res.json({ data: pnl });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
