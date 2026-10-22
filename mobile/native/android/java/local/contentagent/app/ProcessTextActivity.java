package local.contentagent.app;

/** 0.8.0 系统文字选择菜单“发给 Agent”（ACTION_PROCESS_TEXT，只读，不回写）。逻辑与分享入口共用。 */
public class ProcessTextActivity extends ShareReceiverActivity {
    @Override
    protected String channel() { return "process_text"; }
}
