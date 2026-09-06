import { api } from '../api.js';
import { escapeHtml } from '../format.js';

export function renderLogin() {
  return `
    <div class="login-screen">
      <form class="login-card" id="login-form">
        <div class="login-card__logo">
          <span class="logo__icon"><i class="fa-solid fa-cubes-stacked"></i></span>
          <span class="logo__text">MebelFlow</span>
        </div>
        <p class="login-card__subtitle">Войдите, чтобы открыть систему управления производством</p>
        <div class="form">
          <label>Email
            <input type="email" id="login-email" autocomplete="username" required placeholder="ivan@mebelflow.uz" />
          </label>
          <label>Пароль
            <input type="password" id="login-password" autocomplete="current-password" required placeholder="••••••••" />
          </label>
        </div>
        <div class="login-card__error" id="login-error" hidden></div>
        <button type="submit" class="btn btn--primary login-card__submit" id="login-submit">Войти</button>
      </form>
    </div>
  `;
}

export function attachLoginHandlers(root, onSuccess) {
  const form = root.querySelector('#login-form');
  const errorBox = root.querySelector('#login-error');
  const submitBtn = root.querySelector('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Входим...';
    try {
      const email = root.querySelector('#login-email').value.trim();
      const password = root.querySelector('#login-password').value;
      await api.login(email, password);
      onSuccess();
    } catch (err) {
      errorBox.textContent = escapeHtml(err.message || 'Не удалось войти');
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
    }
  });
}
