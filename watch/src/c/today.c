// today — your plan's timer on your wrist. Read-only.
//
// The phone (src/pkjs/index.js) signs in, fetches the plan from
// today.lost.plus and sends it here one item per message. This side keeps a
// copy in persistent storage, so the timer shows at once on launch and keeps
// running without the phone. Until the phone is signed in it sends a QR code
// to show instead.
//
// Buttons: SELECT refreshes, hold SELECT to disconnect.

#include <pebble.h>

#define MAX_ITEMS 32
#define NAME_BYTES 64
#define MAX_QR 41  // QR version 6; the pairing link needs version 3

#define PERSIST_COUNT 1
#define PERSIST_ITEM_BASE 100

// Status values sent by the phone, in step with src/pkjs/index.js.
enum { STATUS_OK = 0, STATUS_CONNECTING = 1, STATUS_PAIRING = 2, STATUS_OFFLINE = 3 };

typedef struct {
  int32_t start;
  int32_t end;
  char name[NAME_BYTES];
} Item;

static Window *s_window;
static Layer *s_canvas;

static Item s_items[MAX_ITEMS];
static int s_count;
static int s_pending_count = -1;  // an item list is arriving
static int s_status = STATUS_CONNECTING;
static bool s_have_items;  // a list has been stored at least once

static uint8_t s_qr[(MAX_QR * MAX_QR + 7) / 8];
static int s_qr_size;

static int s_last_active = -2;
static int s_last_completed = -1;

/* ---------- strings ---------- */

static bool s_korean;

typedef enum { S_NOW, S_STARTS, S_BREAK, S_NEXT, S_DONE, S_EMPTY, S_EMPTY_HINT, S_CONNECTING, S_SCAN, S_OFFLINE } StringId;

static const char *const EN[] = {
    "Now", "Starts %s", "Break \xc2\xb7 next %s", "Next %s %s", "Done for today", "No plan today",
    "Write one at today.lost.plus", "Connecting to your phone\xe2\x80\xa6", "Scan with your phone",
    "Can't reach your phone",
};
static const char *const KO[] = {
    "\xec\xa7\x80\xea\xb8\x88",  // 지금
    "%s \xec\x8b\x9c\xec\x9e\x91",  // %s 시작
    "\xec\x89\xac\xeb\x8a\x94 \xec\x8b\x9c\xea\xb0\x84 \xc2\xb7 %s",  // 쉬는 시간 · %s
    "\xeb\x8b\xa4\xec\x9d\x8c %s %s",  // 다음 %s %s
    "\xec\x98\xa4\xeb\x8a\x98 \xeb\x81\x9d",  // 오늘 끝
    "\xec\x98\xa4\xeb\x8a\x98 \xea\xb3\x84\xed\x9a\x8d \xec\x97\x86\xec\x9d\x8c",  // 오늘 계획 없음
    "today.lost.plus\xec\x97\x90\xec\x84\x9c \xec\xa0\x81\xec\x96\xb4\xec\xa3\xbc\xec\x84\xb8\xec\x9a\x94",  // today.lost.plus에서 적어주세요
    "\xed\x9c\xb4\xeb\x8c\x80\xed\x8f\xb0\xea\xb3\xbc \xec\x97\xb0\xea\xb2\xb0 \xec\xa4\x91\xe2\x80\xa6",  // 휴대폰과 연결 중…
    "\xed\x9c\xb4\xeb\x8c\x80\xed\x8f\xb0\xec\x9c\xbc\xeb\xa1\x9c \xec\x8a\xa4\xec\xba\x94",  // 휴대폰으로 스캔
    "\xed\x9c\xb4\xeb\x8c\x80\xed\x8f\xb0\xec\x97\x90 \xec\x97\xb0\xea\xb2\xb0\xed\x95\xa0 \xec\x88\x98 \xec\x97\x86\xec\x96\xb4\xec\x9a\x94",  // 휴대폰에 연결할 수 없어요
};

static const char *str(StringId id) { return s_korean ? KO[id] : EN[id]; }

/* ---------- storage ---------- */

static void save_items(void) {
  persist_write_int(PERSIST_COUNT, s_count);
  for (int i = 0; i < s_count; i++) {
    persist_write_data(PERSIST_ITEM_BASE + i, &s_items[i], sizeof(Item));
  }
}

static void load_items(void) {
  if (!persist_exists(PERSIST_COUNT)) return;
  s_have_items = true;
  s_count = persist_read_int(PERSIST_COUNT);
  if (s_count < 0 || s_count > MAX_ITEMS) s_count = 0;
  for (int i = 0; i < s_count; i++) {
    if (persist_read_data(PERSIST_ITEM_BASE + i, &s_items[i], sizeof(Item)) != (int)sizeof(Item)) {
      s_count = i;
      break;
    }
    s_items[i].name[NAME_BYTES - 1] = '\0';
  }
}

static void forget_items(void) {
  s_count = 0;
  s_have_items = false;
  persist_delete(PERSIST_COUNT);
}

/* ---------- where are we in the day ---------- */

typedef enum { K_ACTIVE, K_WAITING, K_BREAK, K_FINISHED, K_EMPTY } Kind;

typedef struct {
  Kind kind;
  int index;
  int completed;
} DayState;

static DayState day_state(time_t now) {
  DayState state = {K_EMPTY, -1, 0};
  if (s_count == 0) return state;
  for (int i = 0; i < s_count; i++) {
    if (now >= s_items[i].end) state.completed++;
  }
  for (int i = 0; i < s_count; i++) {
    if (now >= s_items[i].start && now < s_items[i].end) {
      state.kind = K_ACTIVE;
      state.index = i;
      return state;
    }
  }
  for (int i = 0; i < s_count; i++) {
    if (now < s_items[i].start) {
      state.kind = state.completed > 0 ? K_BREAK : K_WAITING;
      state.index = i;
      return state;
    }
  }
  state.kind = K_FINISHED;
  return state;
}

static void format_clock(time_t t, char *out, size_t size) {
  struct tm *local = localtime(&t);
  strftime(out, size, clock_is_24h_style() ? "%H:%M" : "%l:%M", local);
  if (out[0] == ' ') memmove(out, out + 1, strlen(out));
}

static void format_countdown(int seconds, char *out, size_t size) {
  if (seconds < 0) seconds = 0;
  int h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60;
  if (h > 0) snprintf(out, size, "%d:%02d:%02d", h, m, s);
  else snprintf(out, size, "%02d:%02d", m, s);
}

/* ---------- drawing ---------- */

static GColor accent(void) { return PBL_IF_COLOR_ELSE(GColorBlueMoon, GColorBlack); }

static GColor muted(void) { return PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack); }

static bool big_screen(GRect bounds) { return bounds.size.w >= 200; }

/** Draw text centred in a box; returns the height it took. */
static int draw_text(GContext *ctx, const char *text, GFont font, GRect box, GColor color) {
  graphics_context_set_text_color(ctx, color);
  GSize size = graphics_text_layout_get_content_size(text, font, box, GTextOverflowModeTrailingEllipsis,
                                                     GTextAlignmentCenter);
  box.size.h = size.h + 4;
  graphics_draw_text(ctx, text, font, box, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  return box.size.h;
}

static void draw_message(GContext *ctx, GRect bounds, const char *title, const char *hint) {
  bool big = big_screen(bounds);
  GFont title_font = fonts_get_system_font(big ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_24_BOLD);
  GFont hint_font = fonts_get_system_font(big ? FONT_KEY_GOTHIC_18 : FONT_KEY_GOTHIC_14);
  GRect box = grect_inset(bounds, GEdgeInsets(0, PBL_IF_ROUND_ELSE(24, 8)));
  GSize title_size = graphics_text_layout_get_content_size(title, title_font, box, GTextOverflowModeWordWrap,
                                                           GTextAlignmentCenter);
  int y = bounds.size.h / 2 - title_size.h / 2 - (hint ? 10 : 4);
  y += draw_text(ctx, title, title_font, GRect(box.origin.x, y, box.size.w, 80), GColorBlack);
  if (hint) draw_text(ctx, hint, hint_font, GRect(box.origin.x, y, box.size.w, 60), muted());
}

static void draw_qr(GContext *ctx, GRect bounds) {
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  bool big = big_screen(bounds);
  GFont font = fonts_get_system_font(big ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_14_BOLD);
  int caption = big ? 26 : 20;

  // Largest whole-pixel module that fits with a 2-module quiet zone; on a
  // round screen the code has to sit inside the circle.
  int room_w = bounds.size.w, room_h = bounds.size.h - caption;
#if defined(PBL_ROUND)
  room_w = room_h = bounds.size.w * 68 / 100;
#endif
  int side = room_w < room_h ? room_w : room_h;
  int module = side / (s_qr_size + 4);
  if (module < 1) module = 1;
  int drawn = module * s_qr_size;
  int x0 = (bounds.size.w - drawn) / 2;
  int y0 = PBL_IF_ROUND_ELSE((bounds.size.h - drawn) / 2 - caption / 3, (bounds.size.h - caption - drawn) / 2);

  graphics_context_set_fill_color(ctx, GColorBlack);
  for (int r = 0; r < s_qr_size; r++) {
    for (int c = 0; c < s_qr_size; c++) {
      int bit = r * s_qr_size + c;
      if (s_qr[bit / 8] & (1 << (7 - bit % 8))) {
        graphics_fill_rect(ctx, GRect(x0 + c * module, y0 + r * module, module, module), 0, GCornerNone);
      }
    }
  }
  draw_text(ctx, str(S_SCAN), font, GRect(0, y0 + drawn + (big ? 4 : 1), bounds.size.w, caption), GColorBlack);
}

static void draw_timer(GContext *ctx, GRect bounds, DayState state, time_t now) {
  bool big = big_screen(bounds);
  GRect inner = grect_inset(bounds, GEdgeInsets(0, PBL_IF_ROUND_ELSE(big ? 30 : 22, 6)));
  GFont kicker_font = fonts_get_system_font(big ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD);
  GFont name_font = fonts_get_system_font(big ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_24_BOLD);
  GFont next_font = fonts_get_system_font(big ? FONT_KEY_GOTHIC_18 : FONT_KEY_GOTHIC_14);

  Item *item = &s_items[state.index];
  char kicker[48], timer[16], clock_text[8], next[NAME_BYTES + 24];
  next[0] = '\0';
  int seconds;
  if (state.kind == K_ACTIVE) {
    snprintf(kicker, sizeof(kicker), "%s", str(S_NOW));
    seconds = item->end - now;
    if (state.index + 1 < s_count) {
      format_clock(s_items[state.index + 1].start, clock_text, sizeof(clock_text));
      snprintf(next, sizeof(next), str(S_NEXT), clock_text, s_items[state.index + 1].name);
    }
  } else {
    format_clock(item->start, clock_text, sizeof(clock_text));
    snprintf(kicker, sizeof(kicker), str(state.kind == K_BREAK ? S_BREAK : S_STARTS), clock_text);
    seconds = item->start - now;
  }
  format_countdown(seconds, timer, sizeof(timer));

  // The countdown sits in the middle; the biggest font that fits wins.
  static const char *const timer_fonts[] = {FONT_KEY_LECO_42_NUMBERS, FONT_KEY_LECO_36_BOLD_NUMBERS,
                                            FONT_KEY_LECO_32_BOLD_NUMBERS, FONT_KEY_LECO_28_LIGHT_NUMBERS};
  GFont timer_font = NULL;
  GSize timer_size = GSizeZero;
  for (unsigned i = 0; i < ARRAY_LENGTH(timer_fonts); i++) {
    timer_font = fonts_get_system_font(timer_fonts[i]);
    timer_size = graphics_text_layout_get_content_size(timer, timer_font, GRect(0, 0, 400, 60),
                                                       GTextOverflowModeFill, GTextAlignmentLeft);
    if (timer_size.w <= inner.size.w) break;
  }
  int timer_y = bounds.size.h / 2 - timer_size.h / 2 + (big ? 8 : 6);

  // Name above the countdown, at most two lines; the kicker above that.
  GRect name_box = GRect(inner.origin.x, 0, inner.size.w, big ? 62 : 54);
  GSize name_size = graphics_text_layout_get_content_size(item->name, name_font, name_box,
                                                          GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter);
  if (name_size.h > name_box.size.h) name_size.h = name_box.size.h;
  int name_y = timer_y - name_size.h - (big ? 8 : 6);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, item->name, name_font, GRect(inner.origin.x, name_y, inner.size.w, name_size.h + 4),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  int kicker_h = big ? 28 : 22;
  draw_text(ctx, kicker, kicker_font, GRect(inner.origin.x, name_y - kicker_h, inner.size.w, kicker_h),
            state.kind == K_ACTIVE ? accent() : muted());

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, timer, timer_font, GRect(0, timer_y - (big ? 6 : 5), bounds.size.w, timer_size.h + 8),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  // Progress through the current item.
  int bar_y = timer_y + timer_size.h + (big ? 12 : 9);
  int bar_w = inner.size.w * (big ? 70 : 76) / 100;
  int bar_x = (bounds.size.w - bar_w) / 2;
  if (state.kind == K_ACTIVE) {
    int length = item->end - item->start;
    int filled = length > 0 ? bar_w * (int)(now - item->start) / length : 0;
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
    graphics_fill_rect(ctx, GRect(bar_x, bar_y, bar_w, 4), 2, GCornersAll);
#if !defined(PBL_COLOR)
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_draw_round_rect(ctx, GRect(bar_x, bar_y, bar_w, 4), 2);
#endif
    graphics_context_set_fill_color(ctx, accent());
    graphics_fill_rect(ctx, GRect(bar_x, bar_y, filled, 4), 2, GCornersAll);
  }
  if (next[0]) {
    draw_text(ctx, next, next_font, GRect(inner.origin.x, bar_y + (big ? 10 : 7), inner.size.w, big ? 24 : 20),
              muted());
  }
}

static void canvas_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (s_status == STATUS_PAIRING && s_qr_size > 0) {
    draw_qr(ctx, bounds);
    return;
  }
  if (!s_have_items) {
    draw_message(ctx, bounds, str(s_status == STATUS_OFFLINE ? S_OFFLINE : S_CONNECTING), NULL);
    return;
  }

  time_t now = time(NULL);
  DayState state = day_state(now);
  if (state.kind == K_EMPTY) {
    draw_message(ctx, bounds, str(S_EMPTY), str(S_EMPTY_HINT));
  } else if (state.kind == K_FINISHED) {
    draw_message(ctx, bounds, str(S_DONE), NULL);
  } else {
    draw_timer(ctx, bounds, state, now);
  }
}

/* ---------- ticking ---------- */

static void check_transitions(bool quiet) {
  DayState state = day_state(time(NULL));
  int active = state.kind == K_ACTIVE ? state.index : -1;
  // An item ended or began since the last tick: tap the wrist.
  bool ended = state.completed > s_last_completed;
  bool began = active >= 0 && active != s_last_active;
  if (!quiet && s_last_completed >= 0 && (ended || began)) vibes_double_pulse();
  s_last_completed = state.completed;
  s_last_active = active;
}

static void tick(struct tm *tick_time, TimeUnits changed) {
  check_transitions(false);
  layer_mark_dirty(s_canvas);
}

/* ---------- phone messages ---------- */

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *t;
  if ((t = dict_find(iter, MESSAGE_KEY_Status))) {
    s_status = t->value->int32;
    if (s_status != STATUS_PAIRING) s_qr_size = 0;
  }
  if ((t = dict_find(iter, MESSAGE_KEY_Qr))) {
    Tuple *size = dict_find(iter, MESSAGE_KEY_QrSize);
    int n = size ? size->value->int32 : 0;
    if (n > 0 && n <= MAX_QR && t->length >= (uint16_t)((n * n + 7) / 8)) {
      memcpy(s_qr, t->value->data, (n * n + 7) / 8);
      s_qr_size = n;
      s_status = STATUS_PAIRING;
      forget_items();
    }
  }
  if ((t = dict_find(iter, MESSAGE_KEY_Count))) {
    int count = t->value->int32;
    s_pending_count = count < 0 ? 0 : count > MAX_ITEMS ? MAX_ITEMS : count;
    if (s_pending_count == 0) {
      s_count = 0;
      s_have_items = true;
      s_pending_count = -1;
      save_items();
      check_transitions(true);
    }
  }
  if ((t = dict_find(iter, MESSAGE_KEY_Index)) && s_pending_count > 0) {
    int i = t->value->int32;
    Tuple *start = dict_find(iter, MESSAGE_KEY_Start);
    Tuple *end = dict_find(iter, MESSAGE_KEY_End);
    Tuple *name = dict_find(iter, MESSAGE_KEY_Name);
    if (i >= 0 && i < s_pending_count && start && end && name) {
      s_items[i].start = start->value->int32;
      s_items[i].end = end->value->int32;
      strncpy(s_items[i].name, name->value->cstring, NAME_BYTES - 1);
      s_items[i].name[NAME_BYTES - 1] = '\0';
      if (i == s_pending_count - 1) {
        // The last item landed: swap the new list in.
        s_count = s_pending_count;
        s_pending_count = -1;
        s_have_items = true;
        save_items();
        check_transitions(true);
      }
    }
  }
  layer_mark_dirty(s_canvas);
}

static void send_flag(uint32_t key) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) return;
  dict_write_uint8(out, key, 1);
  app_message_outbox_send();
}

static void select_click(ClickRecognizerRef recognizer, void *context) { send_flag(MESSAGE_KEY_Refresh); }

static void select_long_click(ClickRecognizerRef recognizer, void *context) {
  forget_items();
  s_status = STATUS_CONNECTING;
  s_qr_size = 0;
  vibes_short_pulse();
  send_flag(MESSAGE_KEY_Unpair);
  layer_mark_dirty(s_canvas);
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, select_long_click, NULL);
}

/* ---------- lifecycle ---------- */

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_canvas = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_canvas, canvas_update);
  layer_add_child(root, s_canvas);
}

static void window_unload(Window *window) { layer_destroy(s_canvas); }

static void init(void) {
  const char *locale = i18n_get_system_locale();
  s_korean = locale && strncmp(locale, "ko", 2) == 0;
  load_items();
  check_transitions(true);

  s_window = window_create();
  window_set_background_color(s_window, GColorWhite);
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});
  window_stack_push(s_window, true);

  app_message_register_inbox_received(inbox_received);
  app_message_open(512, 64);
  tick_timer_service_subscribe(SECOND_UNIT, tick);
}

static void deinit(void) {
  tick_timer_service_unsubscribe();
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
