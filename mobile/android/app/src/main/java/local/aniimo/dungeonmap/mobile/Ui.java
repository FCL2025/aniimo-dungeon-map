package local.aniimo.dungeonmap.mobile;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    static final int INK = Color.rgb(16,38,48), PANEL = Color.rgb(24,47,60);
    static final int TEXT = Color.rgb(220,232,230), MUTED = Color.rgb(165,186,196);
    static final int AQUA = Color.rgb(121,202,190), GOLD = Color.rgb(223,182,91);
    static int dp(Context c, float n) { return Math.round(n*c.getResources().getDisplayMetrics().density); }
    static GradientDrawable background(Context c, int color, int stroke, float radius) {
        GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(c,radius));
        if (stroke != 0) d.setStroke(dp(c,1),stroke); return d;
    }
    static TextView text(Context c, String value, float size, int color) {
        TextView v = new TextView(c); v.setText(value); v.setTextSize(size); v.setTextColor(color);
        v.setGravity(Gravity.CENTER_VERTICAL); v.setFontFeatureSettings("kern"); return v;
    }
    static Button button(Context c, String value) {
        Button b = new Button(c); b.setText(value); b.setTextSize(13); b.setAllCaps(false);
        b.setTextColor(TEXT); b.setMinHeight(dp(c,48)); b.setMinimumHeight(dp(c,48));
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(c,10),0,dp(c,10),0);
        b.setBackgroundTintList(ColorStateList.valueOf(PANEL)); return b;
    }
    static LinearLayout column(Context c) { LinearLayout v = new LinearLayout(c); v.setOrientation(LinearLayout.VERTICAL); return v; }
    static LinearLayout row(Context c) { LinearLayout v = new LinearLayout(c); v.setGravity(Gravity.CENTER_VERTICAL); return v; }
    static LinearLayout.LayoutParams weight() { return new LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.WRAP_CONTENT,1); }
    static void heading(TextView v) { v.setTypeface(Typeface.DEFAULT,Typeface.BOLD); }
}
