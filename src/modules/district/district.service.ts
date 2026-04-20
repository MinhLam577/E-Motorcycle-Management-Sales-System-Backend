import { Injectable, NotFoundException } from '@nestjs/common';
import { AddressAPI } from 'src/constants/address.enum';
import { ResponseDistrict } from './dto/district.response';

@Injectable()
export class DistrictService {
  async getDistrictByProvinceCode(provinceCode: number) {
    try {
      const query = AddressAPI.PROVINCE_API + provinceCode + '?depth=2';
      const response = await fetch(query, {
        method: 'GET',
      });
      const data = await response.json();
      const districts = data?.districts?.map((d) => ({
        name: d.name,
        code: d.code,
      }));
      return districts;
    } catch (e) {
      throw e;
    }
  }
}
