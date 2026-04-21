import { Injectable, NotFoundException } from '@nestjs/common';
import { AddressAPI } from 'src/constants/address.enum';

@Injectable()
export class WardService {
  async getWardByDistrictCode(districtCode?: number) {
    try {
      const query = AddressAPI.DISTRICT_API + districtCode + '?depth=2';
      const response = await fetch(query, {
        method: 'GET',
      });
      const data = await response.json();
      const wards = data?.wards?.map((w) => ({
        name: w.name,
        code: w.code,
      }));
      return wards;
    } catch (e) {
      throw e;
    }
  }
}
