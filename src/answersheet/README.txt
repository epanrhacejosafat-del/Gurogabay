HOW TO ADD THIS TO YOUR APP

1. Copy this whole "answersheet" folder into your app's src folder
   (example: src/answersheet/).
2. In your terminal, inside your project, run:
      npx expo install expo-print
3. Open supabase.sql, copy everything, paste it in Supabase > SQL Editor > Run.
4. Use the screens:
      AnswerSheetSetup  -> choose number of items (max 100) and A-B / A-C / A-D / A-E / True-False
      HeaderEditor      -> edit Name, Class, Quiz, Date, Score box, add more fields
      printAnswerSheet(config, header, title) -> prints or saves the sheet
