---
title: "Полная справка по вики"
desc: "Все возможности, синтаксис и правила использования"
order: 100
icon: book
---

# Полная справка по системе вики

Эта система — файловая вики, полностью работающая на Markdown. Ниже описано ВСЁ, что поддерживается.

## 1. Структура проекта

content/ — все страницы  
public/assets/ — все ассеты (иконки, картинки)

Раздел = папка  
Страница = .md файл  
index.md — главная страница раздела

## 2. Front matter

```yaml
---
title: "Название"
desc: "Описание"
order: 1
icon: book
hideTitle: false
header: /assets/headers/demo.png
headerHeight: 240
---
```

## 3. Заголовок страницы

- По умолчанию отображается
- Можно скрыть через hideTitle: true
- Иконка страницы отображается рядом с заголовком

## 4. Иконки

Папка: public/assets/icons  
Форматы: svg, png

Использование:
- Раздел: icon в index.md
- Страница: icon в .md
- Callout: icon
- Инлайн: [[icon:name|h=16]]

## 5. Callout

```callout
type: info
icon: idea
title: Заголовок
text: Текст
```

Типы: info, warning, success, error

## 6. Обычные изображения

```image
src: /assets/gallery/one.png
align: center
width: 60%
caption: Подпись
```

## 7. Галерея

```gallery
- /assets/gallery/one.png
- /assets/gallery/two.png
```

## 8. Инлайн элементы

[[icon:idea|h=16]]  
[[img:/assets/logo-color.svg|h=18]]

## 9. Градиентный текст

<gradient:#e61f4b:#a51635>Текст</gradient>

## 10. Цветной текст

<#3e9eff>Текст</#3e9eff>

## 11. Ссылки

[[cat:guide|Раздел]]  
[[page:guide/install|Страница]]

## 12. Навигация

ЛКМ — свернуть/развернуть  
ПКМ — свернуть/развернуть  
Ctrl/Cmd — перейти

## 13. Ассеты

Только латиница  
Пути от /assets/

## 14. Редактирование

Любой редактор Markdown. Сохранил — обновил страницу.

## 15. Философия

Просто. Предсказуемо. Расширяемо.
