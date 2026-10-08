const API_BASE = 'https://www.weavine.com';
const RESPONSE_LABEL = { yes: '参加', maybe: '可能', no: '不去' };

Page({
  data: {
    loading: true,
    failed: false,
    failText: '',
    type: 'note',
    kindLabel: '笔记分享',
    title: '',
    content: '',
    when: '',
    location: '',
    isEvent: false,
    rsvpName: '',
    rsvpDone: false,
    rsvpError: '',
    viewCount: 0,
  },

  token: '',

  onLoad(options) {
    this.token = options.token || '';
    if (!this.token) {
      this.setData({ loading: false, failed: true, failText: '缺少分享参数' });
      return;
    }
    this.fetchShare();
  },

  fetchShare() {
    const that = this;
    wx.request({
      url: `${API_BASE}/api/public/share/${this.token}`,
      method: 'GET',
      success(res) {
        if (res.statusCode !== 200) {
          that.setData({ loading: false, failed: true, failText: '该分享不存在或已被撤销' });
          return;
        }
        const d = res.data;
        const isEvent = d.type === 'event';
        let when = '';
        if (d.start) {
          when = d.end ? `${d.start} ~ ${d.end}` : d.start;
        }
        that.setData({
          loading: false,
          type: d.type,
          kindLabel: isEvent ? '日程邀请' : '笔记分享',
          title: d.title,
          content: d.content || '',
          when,
          location: d.location || '',
          isEvent,
          viewCount: d.viewCount || 0,
        });
        wx.setNavigationBarTitle({ title: d.title || '织遇 · 分享' });
      },
      fail() {
        that.setData({ loading: false, failed: true, failText: '网络异常，请稍后重试' });
      },
    });
  },

  onNameInput(e) {
    this.setData({ rsvpName: e.detail.value });
  },

  rsvp(e) {
    const response = e.currentTarget.dataset.r;
    const name = this.data.rsvpName.trim();
    if (!name) {
      this.setData({ rsvpError: '请先填写称呼' });
      return;
    }
    const that = this;
    wx.request({
      url: `${API_BASE}/api/public/share/${this.token}/rsvp`,
      method: 'POST',
      data: { name, response },
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.statusCode === 200) {
          that.setData({ rsvpDone: true, rsvpError: '' });
        } else {
          that.setData({ rsvpError: (res.data && String(res.data)) || '回应失败' });
        }
      },
      fail() {
        that.setData({ rsvpError: '网络异常，请稍后重试' });
      },
    });
  },

  responseLabel(r) {
    return RESPONSE_LABEL[r] || r;
  },

  copyLink() {
    wx.setClipboardData({
      data: `${API_BASE}/s/${this.token}`,
      success() {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      },
    });
  },
});
