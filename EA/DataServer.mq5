//+------------------------------------------------------------------+
//|                                                   DataServer.mq5 |
//|                                      Copyright 2024, AI Assistant|
//|                                                                  |
//+------------------------------------------------------------------+
#property copyright "AI Assistant"
#property link      ""
#property version   "1.01"
#property strict

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   EventSetMillisecondTimer(100);
   Print("DataServer EA Started v1.01");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

//+------------------------------------------------------------------+
//| Timer function                                                   |
//+------------------------------------------------------------------+
void OnTimer()
  {
   if(FileIsExist("req.txt"))
     {
      int req_handle = FileOpen("req.txt", FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
      if(req_handle != INVALID_HANDLE)
        {
         string req_str = FileReadString(req_handle);
         FileClose(req_handle);
         FileDelete("req.txt");
         
         string req_parts[];
         StringSplit(req_str, ',', req_parts);
         
         if(ArraySize(req_parts) >= 3)
           {
            string symbol = req_parts[0];
            string tf_str = req_parts[1];
            int count = (int)StringToInteger(req_parts[2]);
            datetime end_time = 0;
            if(ArraySize(req_parts) >= 4) {
               end_time = (datetime)StringToInteger(req_parts[3]);
            }
            
            // Limit count to avoid EA freezing
            if (count > 50000) count = 50000;
            
            ENUM_TIMEFRAMES tf = PERIOD_H1;
            if(tf_str == "M1") tf = PERIOD_M1;
            else if(tf_str == "M5") tf = PERIOD_M5;
            else if(tf_str == "M15") tf = PERIOD_M15;
            else if(tf_str == "M30") tf = PERIOD_M30;
            else if(tf_str == "H1") tf = PERIOD_H1;
            else if(tf_str == "H4") tf = PERIOD_H4;
            else if(tf_str == "D1") tf = PERIOD_D1;
            
            MqlRates rates[];
            int copied = 0;
            if (end_time > 0) {
               copied = CopyRates(symbol, tf, end_time, count, rates);
            } else {
               copied = CopyRates(symbol, tf, 0, count, rates);
            }
            
            if(copied > 0)
              {
               int res_handle = FileOpen("res.csv", FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE, ',');
               if(res_handle != INVALID_HANDLE)
                 {
                  FileWrite(res_handle, "time", "open", "high", "low", "close", "tick_volume", "spread", "real_volume");
                  for(int i=0; i<copied; i++)
                    {
                     FileWrite(res_handle, 
                               (long)rates[i].time, 
                               rates[i].open, 
                               rates[i].high, 
                               rates[i].low, 
                               rates[i].close, 
                               rates[i].tick_volume,
                               rates[i].spread,
                               rates[i].real_volume);
                    }
                  FileClose(res_handle);
                 }
              }
            else {
               int res_handle = FileOpen("res.csv", FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE, ',');
               if(res_handle != INVALID_HANDLE) FileClose(res_handle);
            }
           }
        }
     }
  }
